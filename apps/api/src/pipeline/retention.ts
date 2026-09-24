import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Data, Effect } from "effect";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TIMEZONE } from "./run";

// What the database keeps, and for how long. The article text is only needed while an edition
// can still be written from it; a seen link only while the collector could meet it again; and a
// cancelled subscriber only while they might come back through the old link. After that, keeping
// any of it is storage and, for the subscriber, personal data with no purpose left (LGPD).
export const TEXT_RETENTION_DAYS = 30;
export const SEEN_URL_RETENTION_DAYS = 30;
export const CANCELLED_RETENTION_DAYS = 90;

// One pass a day, in the quiet hour between the backup and the generation. Every day: the tables
// grow on Sunday too.
export const RETENTION_SCHEDULE = "0 4 * * *";

// Rows per statement. A table that grew for months is trimmed in slices, so no single statement
// holds a lock for long or fills the WAL in one go.
export const RETENTION_BATCH = 1_000;

export class RetentionDbFailed extends Data.TaggedError("RetentionDbFailed")<{ reason: string }> {}

export type RetentionReport = { textsCleared: number; seenUrlsDeleted: number; subscribersPurged: number };

@Injectable()
export class RetentionScheduler {
  private readonly logger = new Logger(RetentionScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(RETENTION_SCHEDULE, { name: "retention", timeZone: TIMEZONE })
  async nightly(): Promise<void> {
    this.logger.log({ msg: "schedule fired", schedule: RETENTION_SCHEDULE, timeZone: TIMEZONE });
    await Effect.runPromise(Effect.ignore(this.run()));
  }

  // Runs the three trims and reports what each took. A failure in one is logged and stops the
  // pass; tomorrow's pass picks up where it left, because every statement only touches what is
  // still past the window.
  run(now: Date = new Date()): Effect.Effect<RetentionReport, RetentionDbFailed> {
    return Effect.gen(this, function* () {
      const textsCleared = yield* this.drain("clear article text", (limit) =>
        this.prisma.$executeRaw(Prisma.sql`
          UPDATE "article" SET "extracted_text" = NULL
          WHERE "id" IN (
            SELECT "id" FROM "article"
            WHERE "extracted_text" IS NOT NULL AND "created_at" < ${daysBefore(now, TEXT_RETENTION_DAYS)}
            LIMIT ${limit}
          )`),
      );
      const seenUrlsDeleted = yield* this.drain("delete seen urls", (limit) =>
        this.prisma.$executeRaw(Prisma.sql`
          DELETE FROM "seen_url"
          WHERE "url" IN (
            SELECT "url" FROM "seen_url" WHERE "seen_at" < ${daysBefore(now, SEEN_URL_RETENTION_DAYS)} LIMIT ${limit}
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
      const report = { textsCleared, seenUrlsDeleted, subscribersPurged };
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
