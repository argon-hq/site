# api

NestJS with Mastra. Runs the newsletter agents and, later, sign-up, cron, queues and sending. Source of truth for decisions: the Architecture and Stack documents on OneDrive.

## Layout

- `src/mastra/`: Mastra instance (`index.ts`), `agents/`, `prompts/`, `schemas/`, `tools/`. `MastraModule` is imported last and mounted under `/mastra`.
- `src/edition/`: `POST /edition/write { url }` runs the writer agent on one article.
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

## Database

```bash
pnpm db:migrate    # after editing schema.prisma: creates the next migration and applies it locally
pnpm db:deploy     # applies pending migrations only (what deploy.sh runs in AWS)
pnpm db:studio     # browse the local database
```

Every deploy runs `prisma migrate deploy` from the API image before starting the container, so dev and prod are migrated by the pipeline; never edit the RDS schema by hand. Mastra keeps its own tables in the `mastra` schema, outside Prisma.

```bash
curl -X POST http://localhost:3001/edition/write -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" -d '{"url":"https://agenciabrasil.ebc.com.br/..."}'
```
