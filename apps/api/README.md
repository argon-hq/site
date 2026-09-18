# @argon/api

NestJS with Mastra. Runs the newsletter agents and, later, sign-up, cron, queues and sending. Source of truth for decisions: the Architecture and Stack documents on OneDrive.

## Layout

- `src/mastra/`: Mastra instance (`index.ts`), the single agent `agents/editor.ts`, `skills/<name>/SKILL.md` (one per pipeline step, copied to `dist` by nest-cli assets), `prompts/`, `schemas/`, `tools/`. `MastraModule` is imported last and mounted under `/mastra`.
- `src/pipeline/`: the steps. `POST /pipeline/collect` runs the `collect` skill: the Editor searches the sources (Anthropic web search restricted to `rules.ts` domains), reads pages and scores; `persist.ts` then applies allowlist, window and cutoff and stores what passes, marking every evaluated link in `seen_url`. Errors, retries and outcomes use Effect.
- `src/edition/`: `POST /edition/write { url }` runs the Editor on one article (writing rules only).
- `src/auth/`: global guard; every route needs the `x-internal-secret` header unless marked `@Public()`.
- `src/config.ts`: environment validated with Zod. Names match the Parameter Store keys under `/argon/<env>/`.
- `src/prisma/`: global `PrismaModule`; inject `PrismaService` anywhere. Client generated into `src/generated/prisma` (ignored by git) by `prisma generate`, which runs before build, dev, test and check-types.
- `src/settings/`: `settings.schema.ts` is the single source of truth for setting names, types and defaults; `SettingsService.load()` reads the table into the typed object (the pipeline loads once per run), `get(key)` re-reads one key, `set(key, value)` is the only write path and validates first. Secrets stay in the environment; template copy and theme stay in code.
- `prisma/schema.prisma`: the five application tables from the database diagram. Check constraints, triggers (`updated_at`, frozen articles after send) and the initial `setting` rows live in the migration SQL, not in the schema.

## Run

```bash
pnpm db:up             # local Postgres 16 with pgvector (Docker), argon/argon@localhost:5432/argon_dev
cp .env.example .env   # fill ANTHROPIC_API_KEY and INTERNAL_API_SECRET
pnpm dev               # http://localhost:3001
pnpm mastra:dev        # Mastra Studio. The repeated "does not support listing feedback" log line is a Studio bug (mastra-ai/mastra#23745), harmless.
pnpm test
```

## Conventions

Effect is the standard for typed errors (`Data.TaggedError`), pattern matching (`Match`), retries (`Effect.retry`) and promises (`Effect.tryPromise`); run effects at the Nest boundary with `Effect.runPromise`/`runPromiseExit`.

## Database

Until the first production deploy the schema lives in a single migration, `prisma/migrations/20260917190000_init`. There is no data worth keeping in any environment yet, so a schema change is an edit to that one migration rather than a new one:

```bash
# 1. edit schema.prisma, then regenerate the generated part of the init migration
pnpm db:migrate --create-only --name init   # writes the SQL; keep the hand-written tail below the fold
# 2. re-apply from scratch
pnpm db:reset      # drops the local database and replays init (schema, constraints, triggers, initial settings)
pnpm db:deploy     # applies pending migrations only (what deploy.sh runs in AWS)
pnpm db:studio     # browse the local database
```

The tail of the init migration (check constraints, triggers, the initial `setting` rows) is hand-written and Prisma does not regenerate it — keep it when rewriting the file. Dev is reset by `db:reset`; the lab environment is reset by redeploying against an empty database. Once we go to production this stops: from then on every schema change is a new migration and init is frozen.

Every deploy runs `prisma migrate deploy` from the API image before starting the container, so dev and prod are migrated by the pipeline; never edit the RDS schema by hand. Mastra keeps its own tables in the `mastra` schema, outside Prisma.

```bash
curl -X POST http://localhost:3001/edition/write -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" -d '{"url":"https://agenciabrasil.ebc.com.br/..."}'
```
