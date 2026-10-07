import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Data, Effect } from "effect";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TIMEZONE } from "./run";

// What the database keeps, and for how long. Most of it goes when an edition closes: the text the
// articles were written from, and the fichas nobody chose (see `closeEdition` and `skipEdition`).
// This pass is the net under that, for days that never closed, and the clock for the rest: a seen
// link only while an ingestion could list it again (the 48 h window plus a day); a title signature
// only while a late copy could turn up; a cancelled subscriber only while they might come back
// through the old link. After that, keeping any of it is storage and, for the subscriber, personal
// data with no purpose left (LGPD).
export const TEXT_RETENTION_DAYS = 3;
export const SEEN_URL_RETENTION_DAYS = 3;
export const FICHA_RETENTION_DAYS = 3;
export const SIGNATURE_RETENTION_DAYS = 3;
export const CANCELLED_RETENTION_DAYS = 90;

// A sign-up nobody confirmed is discarded once its link has been dead for this long. The wait is not
// a courtesy: a click on an expired link answers "expired, sign up again" only while the row is still
// there — without it the same click says "invalid".
export const UNCONFIRMED_GRACE_DAYS = 3;

// One pass a day, in the quiet hour between the backup and the generation. Every day: the tables
// grow on Sunday too.
export const RETENTION_SCHEDULE = "0 4 * * *";

// Rows per statement. A table that grew for months is trimmed in slices, so no single statement
// holds a lock for long or fills the WAL in one go.
export const RETENTION_BATCH = 1_000;

export class RetentionDbFailed extends Data.TaggedError("RetentionDbFailed")<{ reason: string }> {}

export type RetentionReport = {
  fichasDeleted: number;
  textsCleared: number;
  signaturesCleared: number;
  seenUrlsDeleted: number;
  subscribersPurged: number;
  unconfirmedDiscarded: number;
};

@Injectable()
export class RetentionScheduler {
  private readonly logger = new Logger(RetentionScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(RETENTION_SCHEDULE, { name: "retention", timeZone: TIMEZONE })
  async nightly(): Promise<void> {
    this.logger.log({ msg: "schedule fired", schedule: RETENTION_SCHEDULE, timeZone: TIMEZONE });
    await Effect.runPromise(Effect.ignore(this.run()));
  }

  // Runs the trims and reports what each took. A failure in one is logged and stops the
  // pass; tomorrow's pass picks up where it left, because every statement only touches what is
  // still past the window.
  run(now: Date = new Date()): Effect.Effect<RetentionReport, RetentionDbFailed> {
    return Effect.gen(this, function* () {
      // A ficha no edition chose, left by a day that never closed.
      const fichasDeleted = yield* this.drain("delete old fichas", (limit) =>
        this.prisma.$executeRaw(Prisma.sql`
          DELETE FROM "article"
          WHERE "id" IN (
            SELECT "id" FROM "article"
            WHERE "edition_id" IS NULL AND "created_at" < ${daysBefore(now, FICHA_RETENTION_DAYS)}
            LIMIT ${limit}
          )`),
      );
      const textsCleared = yield* this.drain("clear article text", (limit) =>
        this.prisma.$executeRaw(Prisma.sql`
          UPDATE "article" SET "extracted_text" = NULL
          WHERE "id" IN (
            SELECT "id" FROM "article"
            WHERE "extracted_text" IS NOT NULL AND "created_at" < ${daysBefore(now, TEXT_RETENTION_DAYS)}
            LIMIT ${limit}
          )`),
      );
      const signaturesCleared = yield* this.drain("clear title signatures", (limit) =>
        this.prisma.$executeRaw(Prisma.sql`
          UPDATE "article" SET "title_signature" = '{}'
          WHERE "id" IN (
            SELECT "id" FROM "article"
            WHERE "title_signature" <> '{}' AND "created_at" < ${daysBefore(now, SIGNATURE_RETENTION_DAYS)}
            LIMIT ${limit}
          )`),
      );
      const seenUrlsDeleted = yield* this.drain("delete seen urls", (limit) =>
        this.prisma.$executeRaw(Prisma.sql`
          DELETE FROM "seen_url"
          WHERE "url_hash" IN (
            SELECT "url_hash" FROM "seen_url" WHERE "seen_at" < ${daysBefore(now, SEEN_URL_RETENTION_DAYS)} LIMIT ${limit}
          )`),
      );
      // Only `cancelled`: a bounced or blocked address is kept so it is never written to again.
      const subscribersPurged = yield* this.drain("purge cancelled subscribers", (limit) =>
        this.prisma.$executeRaw(Prisma.sql`
          DELETE FROM "subscriber"
          WHERE "id" IN (
            SELECT "id" FROM "subscriber"
            WHERE "status" = 'cancelled' AND "cancelled_at" < ${daysBefore(now, CANCELLED_RETENTION_DAYS)}
            LIMIT ${limit}
          )`),
      );
      // Still `pending` three days after the link died: the address never confirmed, so the consent was never
      // completed and nothing is owed to it. The delivery rows a reopened subscription may hold go with it.
      const unconfirmedDiscarded = yield* this.drain("discard unconfirmed sign-ups", (limit) =>
        this.prisma.$executeRaw(Prisma.sql`
          DELETE FROM "subscriber"
          WHERE "id" IN (
            SELECT "id" FROM "subscriber"
            WHERE "status" = 'pending' AND "token_expires_at" < ${daysBefore(now, UNCONFIRMED_GRACE_DAYS)}
            LIMIT ${limit}
          )`),
      );
      const report = {
        fichasDeleted,
        textsCleared,
        signaturesCleared,
        seenUrlsDeleted,
        subscribersPurged,
        unconfirmedDiscarded,
      };
      this.logger.log({ msg: "retention finished", ...report });
      return report;
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => this.logger.error({ msg: "retention failed", reason: error.reason })),
      ),
    );
  }

  // Repeats a statement until it touches fewer rows than the batch, adding up what it did.
  private drain(what: string, statement: (limit: number) => Promise<number>): Effect.Effect<number, RetentionDbFailed> {
    return Effect.gen(this, function* () {
      let total = 0;
      for (;;) {
        const touched = yield* Effect.tryPromise({
          try: () => statement(RETENTION_BATCH),
          catch: (error) => new RetentionDbFailed({ reason: `${what}: ${String(error)}` }),
        });
        total += touched;
        if (touched < RETENTION_BATCH) return total;
      }
    });
  }
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
