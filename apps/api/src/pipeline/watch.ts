import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Data, Effect } from "effect";
import { PrismaService } from "../prisma/prisma.service";
import { OwnerAlert } from "./owner-alert";

// How long an edition may sit in a transient state before it is called stuck. A generation takes
// minutes and a send takes seconds per batch; three hours is a run that died, not a slow one.
export const STUCK_AFTER_HOURS = 3;

export class WatchDbFailed extends Data.TaggedError("WatchDbFailed")<{ reason: string }> {}

export type StuckEdition = { id: string; date: string; status: string; updatedAt: string };

// An edition left in `generating` or `sending` is the one failure nothing else reports: the run
// that would have moved it on is gone, the next day's run works on the next day's row, and the
// alert that goes with a failure was never sent because nothing failed — the process just stopped.
// This looks for them at boot, when a restart is exactly what leaves them behind, and once a day
// after the send should have finished, and says so in the log and to the owners. It fixes nothing:
// resuming is `POST /pipeline/send { date }` or, for a generation, a run by hand.
@Injectable()
export class EditionWatch implements OnApplicationBootstrap {
  private readonly logger = new Logger(EditionWatch.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alert: OwnerAlert,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await Effect.runPromise(Effect.ignore(this.check()));
  }

  // Never fails the caller over a check: a database that cannot answer is logged, and the cron
  // that called it stays alive for tomorrow.
  check(now: Date = new Date()): Effect.Effect<StuckEdition[], WatchDbFailed> {
    return Effect.gen(this, function* () {
      const stuck = yield* this.stuck(now);
      for (const edition of stuck) {
        this.logger.error({ msg: "edition stuck", ...edition });
      }
      if (stuck.length > 0) {
        const lines = stuck.map((e) => `edition ${e.date} is ${e.status} since ${e.updatedAt} (${e.id})`);
        yield* this.alert.send("watch", `${lines.join("\n")}\n\nResume a send with POST /pipeline/send { "date": "YYYY-MM-DD" }.`);
      }
      return stuck;
    }).pipe(Effect.tapError((error) => Effect.sync(() => this.logger.error({ msg: "edition watch failed", reason: error.reason }))));
  }

  private stuck(now: Date): Effect.Effect<StuckEdition[], WatchDbFailed> {
    const before = new Date(now.getTime() - STUCK_AFTER_HOURS * 60 * 60 * 1000);
    return Effect.tryPromise({
      try: () =>
        this.prisma.edition.findMany({
          where: { status: { in: ["generating", "sending"] }, updatedAt: { lt: before } },
          select: { id: true, date: true, status: true, updatedAt: true },
          orderBy: { date: "asc" },
        }),
      catch: (error) => new WatchDbFailed({ reason: String(error) }),
    }).pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          id: row.id,
          date: row.date.toISOString().slice(0, 10),
          status: row.status,
          updatedAt: row.updatedAt.toISOString(),
        })),
      ),
    );
  }
}
