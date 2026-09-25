import { Injectable, Logger } from "@nestjs/common";
import { Data, Effect } from "effect";
import { Client } from "pg";

// One step at a time per edition, enforced by the database and not by a flag in memory: the flag
// only sees this process, and a run that a restart cut halfway, or a second container, or a
// per-step route fired by hand while the 5h30 workflow is on its way, all pass it. A Postgres
// advisory lock is held for as long as the step runs and released when it ends, however it ends.
//
// Session-level, on a connection of its own: a lock taken through the pool would have to be
// released on the very same connection, and the pool hands out whichever is free. So each hold
// opens one connection, keeps it for the life of the step and closes it; that is the extra
// connection the pool arithmetic in src/prisma/pool.ts leaves room for.

export const LOCK_NAMESPACE = "argon-edition";

// The lock is taken for a day, not a step: two steps on the same edition at once is what it exists
// to prevent, whichever two they are.
export function lockKey(day: string): string {
  return `${LOCK_NAMESPACE}:${day}`;
}

export class EditionBusy extends Data.TaggedError("EditionBusy")<{ reason: string }> {}
export class LockDbFailed extends Data.TaggedError("LockDbFailed")<{ reason: string }> {}

// What the lock needs from a connection: enough for a test to answer it without a database.
export type LockClient = {
  connect(): Promise<void>;
  query(text: string, values: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
};

// One `pg` connection behind the narrow shape above.
function pgClient(connectionString: string): LockClient {
  const client = new Client({ connectionString });
  return {
    connect: async () => {
      await client.connect();
    },
    query: (text, values) => client.query(text, values),
    end: () => client.end(),
  };
}

const isLocked = (row: unknown): boolean =>
  typeof row === "object" && row !== null && (row as { locked?: unknown }).locked === true;

@Injectable()
export class EditionLock {
  private readonly logger = new Logger(EditionLock.name);

  constructor(
    private readonly databaseUrl: string,
    private readonly openClient: () => LockClient = () => pgClient(this.databaseUrl),
  ) {}

  // Runs `body` holding the day's lock, or fails at once with EditionBusy when another step holds
  // it. Never waits: a step that finds the edition busy has nothing useful to do but say so.
  hold<A, E>(day: string, step: string, body: Effect.Effect<A, E>): Effect.Effect<A, E | EditionBusy | LockDbFailed> {
    const key = lockKey(day);
    const acquire = Effect.gen(this, function* () {
      const client = this.openClient();
      yield* Effect.tryPromise({
        try: () => client.connect(),
        catch: (error) => new LockDbFailed({ reason: `lock connection: ${String(error)}` }),
      });
      const locked = yield* Effect.tryPromise({
        try: async () => {
          const result = await client.query("select pg_try_advisory_lock(hashtext($1)) as locked", [key]);
          return isLocked(result.rows[0]);
        },
        catch: (error) => new LockDbFailed({ reason: `lock: ${String(error)}` }),
      }).pipe(Effect.tapError(() => Effect.promise(() => client.end().catch(() => undefined))));
      if (!locked) {
        yield* Effect.promise(() => client.end().catch(() => undefined));
        return yield* new EditionBusy({ reason: `edition ${day} is busy with another step; ${step} refused` });
      }
      this.logger.log({ msg: "edition locked", day, step });
      return client;
    });

    const release = (client: LockClient) =>
      Effect.promise(async () => {
        try {
          await client.query("select pg_advisory_unlock(hashtext($1))", [key]);
        } catch (error) {
          // Closing the connection releases a session lock anyway; the log is for the record.
          this.logger.warn({ msg: "edition unlock failed", day, step, reason: String(error) });
        } finally {
          await client.end().catch(() => undefined);
        }
        this.logger.log({ msg: "edition unlocked", day, step });
      });

    return Effect.acquireUseRelease(acquire, () => body, release);
  }
}
