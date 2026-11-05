// Copies the news of a deployed environment into the local database, so the Studio and a local run
// work over real fichas, articles and editions instead of the fixture.
//
//   pnpm db:pull            from dev (the default)
//   pnpm db:pull lab        from lab; prod also works, and only reads
//   pnpm db:pull --check    everything but the copy: reads the source, compares the migrations and
//                           counts what would come, writing nothing locally but the migrations
//
// The source is the environment's Neon branch, its address read from the Parameter Store
// (/argon/<env>/DATABASE_URL, with the AWS profile of the shell, e.g. AWS_PROFILE=argon-new), or
// PULL_DATABASE_URL when set. The target is always the Postgres of compose.local.yml (`pnpm db:up`),
// never what DATABASE_URL names, so the command cannot write anywhere but this machine.
//
// Only the content moves: sources, their feeds, editions, articles and seen links. Subscribers,
// deliveries and settings stay local — a person's address never lands on a laptop, and the local
// settings (owner e-mails, sender) keep pointing at Mailpit. The `mastra` schema stays too: runs,
// traces and datasets are this machine's own. Whatever the local database had in those five tables
// is replaced, and the local deliveries go with the local editions they belonged to.
//
// The two databases must be on the same migration, or the copy would not fit: the local one is
// migrated first, and a source that is behind or ahead stops the command before anything is written.

import "dotenv/config";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { spawn } from "node:child_process";
import { Data, Effect } from "effect";

class PullFailed extends Data.TaggedError("PullFailed")<{ reason: string }> {}

// In the order pg_dump writes them, parents first.
export const CONTENT_TABLES = ["source", "source_feed", "edition", "article", "seen_url"] as const;
const ENVIRONMENTS = ["dev", "lab", "prod"] as const;
type Environment = (typeof ENVIRONMENTS)[number];

const COMPOSE = ["compose", "-f", "compose.local.yml"];
// The local database. PULL_TARGET_DB names another one in the same container, for trying the command
// on a scratch database; it is still this machine's Postgres.
const TARGET_DB = process.env.PULL_TARGET_DB ?? "argon_dev";
const LOCAL = ["psql", "-U", "argon", "-d", TARGET_DB, "-v", "ON_ERROR_STOP=1", "-q"];

// A command inside the local Postgres container. SRC travels as an environment variable named on
// the command line and valued from this process, so the source's password never shows in `ps`.
const inDb = (args: string[], env: Record<string, string> = {}) =>
  spawn("docker", [...COMPOSE, "exec", "-T", ...Object.keys(env).flatMap((k) => ["-e", k]), "db", ...args], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "inherit"],
  });

const finished = (child: ReturnType<typeof spawn>, what: string): Effect.Effect<void, PullFailed> =>
  Effect.async((resume) => {
    child.on("error", (error) => resume(Effect.fail(new PullFailed({ reason: `${what}: ${error.message}` }))));
    child.on("close", (code) =>
      resume(code === 0 ? Effect.void : Effect.fail(new PullFailed({ reason: `${what} exited with ${code}` }))),
    );
  });

const output = (args: string[], env: Record<string, string>, what: string): Effect.Effect<string, PullFailed> =>
  Effect.suspend(() => {
    const child = inDb(args, env);
    child.stdin?.end();
    let text = "";
    child.stdout?.on("data", (chunk: Buffer) => (text += chunk.toString()));
    // Read once the process is done: `Effect.as(text)` would take the text before anything arrived.
    return finished(child, what).pipe(Effect.map(() => text));
  });

const sourceUrl = (env: Environment): Effect.Effect<string, PullFailed> =>
  process.env.PULL_DATABASE_URL
    ? Effect.succeed(process.env.PULL_DATABASE_URL)
    : Effect.tryPromise({
        try: async () => {
          const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "sa-east-1" });
          const answer = await ssm.send(
            new GetParameterCommand({ Name: `/argon/${env}/DATABASE_URL`, WithDecryption: true }),
          );
          if (!answer.Parameter?.Value) throw new Error("the parameter is empty");
          return answer.Parameter.Value;
        },
        catch: (error) =>
          new PullFailed({
            reason: `read /argon/${env}/DATABASE_URL: ${error instanceof Error ? error.message : String(error)} (set AWS_PROFILE, or PULL_DATABASE_URL)`,
          }),
      });

const MIGRATIONS =
  "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1";

const localMigrations = output([...LOCAL, "-At", "-c", MIGRATIONS], {}, "read the local migrations");

// psql inside the container reads the address from SRC through the shell, not from an argument.
const sourceMigrations = (src: string) =>
  output(["sh", "-c", `psql -At -c "${MIGRATIONS}" "$SRC"`], { SRC: src }, "read the source migrations");

const sameMigration = (src: string): Effect.Effect<void, PullFailed> =>
  Effect.gen(function* () {
    const [local, source] = yield* Effect.all([localMigrations, sourceMigrations(src)]);
    if (local.trim() === source.trim()) return;
    const last = (list: string) => list.trim().split("\n").at(-1) ?? "none";
    return yield* new PullFailed({
      reason: `the databases are on different migrations (local ${last(local)}, source ${last(source)}): deploy or pull the code that matches, then run again`,
    });
  });

const migrateLocal: Effect.Effect<void, PullFailed> = Effect.suspend(() =>
  finished(
    spawn("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: `postgresql://argon:argon@localhost:5432/${TARGET_DB}` },
    }),
    "migrate the local database",
  ),
);

// One transaction on the local side: empty the five tables, then the source's rows, with the
// triggers off (the copy carries sent editions, whose articles a trigger freezes).
const copy = (src: string): Effect.Effect<void, PullFailed> =>
  Effect.suspend(() => {
    const dump = inDb(
      [
        "sh",
        "-c",
        `pg_dump --data-only --no-owner --no-privileges ${CONTENT_TABLES.map((t) => `--table=public.${t}`).join(" ")} "$SRC"`,
      ],
      { SRC: src },
    );
    dump.stdin?.end();
    const restore = inDb([...LOCAL, "--single-transaction"]);
    restore.stdin?.write(`SET session_replication_role = replica;\nTRUNCATE ${CONTENT_TABLES.join(", ")} CASCADE;\n`);
    dump.stdout?.pipe(restore.stdin!);
    return Effect.all(
      [finished(dump, "pg_dump from the source"), finished(restore, "restore into the local database")],
      {
        concurrency: 2,
        discard: true,
      },
    );
  });

const counts = output(
  [
    ...LOCAL,
    "-At",
    "-F",
    " ",
    "-c",
    CONTENT_TABLES.map((t) => `SELECT '${t}', count(*) FROM ${t}`).join(" UNION ALL "),
  ],
  {},
  "count the local rows",
);

const sourceCounts = (src: string) =>
  output(
    [
      "sh",
      "-c",
      `psql -At -F " " -c "${CONTENT_TABLES.map((t) => `SELECT '${t}', count(*) FROM ${t}`).join(" UNION ALL ")}" "$SRC"`,
    ],
    { SRC: src },
    "count the source rows",
  );

const pull = (env: Environment, check: boolean) =>
  Effect.gen(function* () {
    const src = yield* sourceUrl(env);
    console.log(`→ migrating the local database`);
    yield* migrateLocal;
    yield* sameMigration(src);
    if (check) {
      console.log(`→ same migration; would copy from ${env}:\n${(yield* sourceCounts(src)).trim()}`);
      return;
    }
    console.log(
      `→ copying ${CONTENT_TABLES.join(", ")} from ${process.env.PULL_DATABASE_URL ? "PULL_DATABASE_URL" : env}`,
    );
    yield* copy(src);
    console.log((yield* counts).trim());
  });

const args = process.argv.slice(2);
const check = args.includes("--check");
const env = (args.find((arg) => !arg.startsWith("--")) ?? "dev") as Environment;
if (!ENVIRONMENTS.includes(env)) {
  console.error(`usage: db:pull [${ENVIRONMENTS.join("|")}] [--check]`);
  process.exit(2);
}

Effect.runPromise(pull(env, check)).catch((error: unknown) => {
  console.error(error instanceof PullFailed ? error.reason : error);
  process.exit(1);
});
