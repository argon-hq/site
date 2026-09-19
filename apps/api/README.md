# api

NestJS with Mastra. Runs the newsletter agents and, later, sign-up, cron, queues and sending. Source of truth for decisions: the Architecture and Stack documents on OneDrive.

## Layout

- `src/mastra/`: Mastra instance (`index.ts`), `agents/`, `prompts/`, `schemas/`, `tools/`. `MastraModule` is imported last and mounted under `/mastra`.
- `src/edition/`: `POST /edition/write { url }` runs the writer agent on one article.
- `src/subscriber/`: `POST /subscriber { email, consentIp?, consentUserAgent? }` records the sign-up as `pending` with a fresh confirmation token (48h, only the hash is stored). Idempotent by e-mail: a confirmed address is left untouched, a bounced or blocked one is ignored, a cancelled one is reopened, and a pending one confirmed less than a minute ago is left alone (`throttled`) so the link already sent keeps working.
  Unsubscribing lives here too: `GET /subscriber/unsubscribe?token=…` only says who the token belongs to, so the page can
  confirm first — a GET that cancelled would unsubscribe people on its own, since e-mail clients follow every link they find.
  `POST /subscriber/unsubscribe { token, reason? }` cancels, and `POST /subscriber/unsubscribe/one-click?token=…` is the
  public RFC 8058 endpoint the `List-Unsubscribe` header announces. The permanent unsubscribe token is issued by
  `issueUnsubscribeToken`, which the confirmation route will call.
- `src/auth/`: global guard; every route needs the `x-internal-secret` header unless marked `@Public()`.
- `src/mail/`: the only way out of the API. `MailService.send()` takes the message and fills `from` from the `sender`
  setting; which provider delivers is bound in `MailModule.forRoot` by `MAIL_TRANSPORT` — `ResendTransport` with the
  injected Resend client in AWS, `SmtpTransport` pointing at the local Mailpit otherwise. Resend is never the default, so
  no development machine reaches a real inbox by accident.
- `src/config.ts`: environment validated with Zod. Names match the Parameter Store keys under `/argon/<env>/`.
- `src/email/`: deterministic e-mail builder. `buildEdition(input)` returns `{ subject, html, text }` from structured content, no LLM, no I/O; `validateEdition` is the mechanical check (parseable HTML, no script, assets and stylesheet on the allowlist, every item link present in both formats, unsubscribe and postal address present, size and length limits). `toEditionInput` adapts `edition` + `article` rows; `editionContext(settings, unsubscribeUrl)` builds the rest from the identity settings (`sender`, `privacy_policy_url`, `asset_base_url`, `social`), with the unsubscribe URL per subscriber. Fixed strings live in `copy.ts`, Figma tokens in `theme.ts`. Icons in `public/email` (`pnpm email:icons`, Font Awesome Free, CC BY 4.0).
- `src/prisma/`: global `PrismaModule`; inject `PrismaService` anywhere. Client generated into `src/generated/prisma` (ignored by git) by `prisma generate`, which runs before build, dev, test and check-types.
- `src/settings/`: `settings.schema.ts` is the single source of truth for setting names, types and defaults; `SettingsService.load()` reads the table into the typed object (the pipeline loads once per run), `get(key)` re-reads one key, `set(key, value)` is the only write path and validates first. Secrets stay in the environment; template copy and theme stay in code.
- `prisma/schema.prisma`: the five application tables from the database diagram. Check constraints, triggers (`updated_at`, frozen articles after send) and the initial `setting` rows live in the migration SQL, not in the schema.

## Run

```bash
pnpm db:up             # local Postgres 16 with pgvector and Mailpit (Docker); inbox at http://localhost:8025
cp .env.example .env   # fill ANTHROPIC_API_KEY and INTERNAL_API_SECRET
pnpm dev               # http://localhost:3001
pnpm mastra:dev        # Mastra Studio. The repeated "does not support listing feedback" log line is a Studio bug (mastra-ai/mastra#23745), harmless.
pnpm test
pnpm email:preview     # out/email-preview*.html and .txt from the fixtures, images inlined, for the visual review
```

## E-mail

```bash
pnpm email:send        # sends the fixture edition through the real transport; locally it lands in Mailpit
pnpm email:icons       # regenerates the social PNGs into apps/web/public/email
```

The images are served by the site, not by the API: `asset_base_url` points at the site's domain in
every environment, and the API has no static route. They live in `apps/web/public/email`, which the
web image copies, so a change only reaches an inbox after the site is deployed. To see them locally,
run the site and point the setting at it:

```bash
docker exec api-db-1 psql -U argon -d argon_dev -c "update setting set value='\"http://localhost:3000/email\"' where key='asset_base_url';"
```

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
curl -X POST http://localhost:3001/subscriber -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" -d '{"email":"someone@example.com"}'
```

```bash
curl -X POST http://localhost:3001/subscriber/unsubscribe -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" -d '{"token":"<unsubscribe token>"}'
```

```bash
curl -X POST http://localhost:3001/edition/write -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" -d '{"url":"https://agenciabrasil.ebc.com.br/..."}'
```
