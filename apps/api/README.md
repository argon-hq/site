# api

NestJS with Mastra. Runs the newsletter agents and, later, sign-up, cron, queues and sending. Source of truth for decisions: the Architecture and Stack documents on OneDrive.

## Layout

- `src/mastra/`: Mastra instance (`index.ts`), the single agent `agents/editor.ts`, `skills/<name>/SKILL.md` (one per pipeline step), `editor/agents/<id>.json`, `prompts/`, `schemas/`, `tools/`, `workflows/`. `MastraModule` is imported last and mounted under `/mastra`.
  `paths.ts` names the two folders that are data and not code — the skills and the Studio's overrides. Neither `__dirname` nor the working directory can name them in both runtimes (the Studio runs an ESM bundle from `src/mastra/public`, the API runs CommonJS from `apps/api`), so it climbs from wherever the process started until it finds the Mastra tree, preferring `src` over `dist` — the image carries only `dist`, filled by the nest-cli assets.
  The Studio's **Editor** edits the agent's instructions and tools. `source: "code"` keeps what it writes in `src/mastra/editor/agents/<id>.json`, one file per agent: a change to the prompt is reviewed in a PR and deployed with everything else, instead of living in the database where each environment could drift with no history. The file only exists once someone edits something.
  `workflows/edition.ts` is the generation as one run — `collect` → `write` → `build`, two retries each. It is registered on the instance, so the Studio draws it and shows the state of every step; since the instance is built at import time, with no Nest around, the steps read the pipeline service from the run context (`workflows/context.ts`), the same way the tools are served. A step reports failure by throwing, which is what makes Mastra try it again; the services keep speaking Effect.
- `src/pipeline/`: the steps. `POST /pipeline/collect` runs the `collect` skill: the Editor searches the sources, reads pages and scores; `persist.ts` then applies allowlist, window and cutoff and stores what passes under the page's own canonical URL, marking every evaluated link in `seen_url`. `rules.ts` holds the one list of sources — it feeds the search allowlist, the persistence check and the step prompt, so the skill never repeats it — plus the window, the search and step ceilings and the text limit. The structured answer gets two attempts (`src/mastra/attempts.ts`). Errors, retries and outcomes use Effect.
  `POST /pipeline/write` then turns what was stored into the edition: `write.ts` opens the day's edition (one row per
  São Paulo calendar day), takes the articles above the cutoff still free of an edition, and the Editor loads the
  `write` skill once per article — two attempts each, the second carrying the validation error. An article rejected
  twice leaves the edition and the others go on; the header (title and subject) is a generation of its own over what
  was approved. Saving is one transaction that detaches whatever an earlier run left attached, so the step can run
  again without growing the edition. Fewer than `min_articles` written and the edition becomes `skipped` with an
  alert to the owners — better no edition than a weak one; but a thin run never downgrades an edition an earlier run
  of the same day already wrote (`belowMinimum`): it fails instead, and the complete edition stands. The skill holds
  the craft; categories and lengths travel from the schema into the step prompt, never into the skill.
  `POST /pipeline/build` closes the generation with no model at all: `build.ts` reads the day's edition and its
  articles, adapts them with `toEditionInput`, builds with `buildEdition` and checks with `validateEdition`. Only a
  clean edition is stored — `html`, `text` and the move from `generating` to `ready` — so a rejected validation leaves
  the edition exactly as it was, fails the step and mails the owners with every rule it broke. The builder is
  deterministic, so running again writes the same two strings. The stored HTML is one edition for everyone, so its
  unsubscribe link carries `UNSUBSCRIBE_PLACEHOLDER` (`src/subscriber/urls.ts`) and the sending step swaps the
  sentinel for each subscriber's token; it is an absolute https URL, so nothing in the validation is relaxed for it.
  `POST /pipeline/run` is the whole generation, as one run of the `edition` workflow: the same three steps, in order, each
  retried on its own, with the day of the edition as the only input (`run.ts`). The steps keep reading the real clock,
  because the collection window is relative to it, and a run for another day stops before touching anything. A run below
  the minimum ends after the writing: there is no edition to build. The clock lives in Nest and not in
  `createWorkflow({ schedule })` — the declarative schedule only runs on the evented engine, whose pubsub is in memory
  and never started by `@mastra/nestjs` — so `scheduler.ts` fires the run at 5h30, Monday to Saturday, America/Sao_Paulo,
  and only where `SCHEDULER_ENABLED` says so. The per-step routes stay, for debugging.
  A failure mails the `owner_emails` from the settings (`owner-alert.ts`) **once**: the alert lives at the boundaries —
  the run, for the step that failed, and each per-step route — never inside a step, where a retry would mail the owners
  once per attempt.
  `profile.ts` is what an environment is willing to pay: `ARGON_ENV` (`local | lab | dev | prod`) picks one row of a
  table in code — the model, how far the agent may search, how long the text may be, and the defaults for the cutoff and
  the article bounds. Production runs the agent on Sonnet; dev runs it on Haiku, searching and reading less and accepting
  a weaker edition; lab and a development machine run **over a fixture**, with no model and no search at all. The dials
  are not rules: what an edition may contain stays in `rules.ts` and is the same everywhere. `POST /pipeline/run
  {"mode":"live"}` pays for a real run in lab or locally without a deploy, and production refuses `mock` whoever asks.
  A mocked run swaps only where the news comes from (`collect-source.ts`) and who writes it (`write-mock.ts`); the
  allowlist, the window, the cutoff, the duplicate check, the schemas and the transaction are the same code either way,
  so what it proves is the pipeline. The fixture's links (`fixtures/news.ts`) carry the day's date so each run collects
  fresh news instead of finding only duplicates — they are not real pages, so the lab edition's links do not open, and
  the text says in every article that it is invented.
- `src/effect/`: `runEffect(step, effect)` is the Nest boundary — controllers hand it an effect and typed failures come back as a 500 carrying the step and the reason. `failureReason(cause)` is what both boundaries, the route and the workflow step, use to say what went wrong.
- `src/subscriber/`: `POST /subscriber { email, consentIp?, consentUserAgent? }` records the sign-up as `pending` with a fresh confirmation token (48h, only the hash is stored). Idempotent by e-mail: a confirmed address is left untouched, a bounced or blocked one is ignored, a cancelled one is reopened, and a pending one confirmed less than a minute ago is left alone (`throttled`) so the link already sent keeps working.
  The confirmation e-mail goes out in the same call. `POST /subscriber/confirm { token }` turns the one-time token into a
  confirmed subscription and issues the permanent unsubscribe token in the same write; the hash of the confirmation token
  is kept, so the same link clicked twice answers `already_confirmed` instead of looking broken.
  Unsubscribing lives here too: `GET /subscriber/unsubscribe?token=…` only says who the token belongs to, so the page can
  confirm first — a GET that cancelled would unsubscribe people on its own, since e-mail clients follow every link they find.
  `POST /subscriber/unsubscribe { token }` cancels, and `POST /subscriber/unsubscribe/one-click?token=…` is the
  public RFC 8058 endpoint the `List-Unsubscribe` header announces. The permanent unsubscribe token is issued by
  `issueUnsubscribeToken`, which the confirmation route will call.
- `src/auth/`: global guard; every route needs the `x-internal-secret` header unless marked `@Public()`.
- `src/subscriber/urls.ts`: every address the subscriber reaches from an e-mail — the confirmation page, the unsubscribe
  page for the footer link, and the API endpoint the `List-Unsubscribe` header announces. The builders receive them ready
  (they build no URL), so this is where the format is decided. The origins are bound once in `SubscriberModule.forRoot`.
- `src/subscriber/confirmation-mail.ts`: composes the sign-up confirmation from the settings and sends it. A provider
  failure clears the send mark before it propagates, or the resend window would block the retry over an e-mail that never
  left.
- `src/mail/`: the only way out of the API. `MailService.send()` takes the message and fills `from` from the `sender`
  setting; which provider delivers is bound in `MailModule.forRoot` by `MAIL_TRANSPORT` — `ResendTransport` with the
  injected Resend client in AWS, `SmtpTransport` pointing at the local Mailpit otherwise. Resend is never the default, so
  no development machine reaches a real inbox by accident.
- `src/config.ts`: environment validated with Zod. Names match the Parameter Store keys under `/argon/<env>/`.
- `src/email/`: deterministic e-mail builder. `buildEdition(input)` returns `{ subject, html, text }` from structured content, no LLM, no I/O; `validateEdition` is the mechanical check (parseable HTML, no script, assets and stylesheet on the allowlist, every item link present in both formats, unsubscribe and postal address present, size and length limits). `toEditionInput` adapts `edition` + `article` rows; `editionContext(settings, unsubscribeUrl)` builds the rest from the identity settings (`sender`, `privacy_policy_url`, `asset_base_url`, `social`), with the unsubscribe URL per subscriber. Fixed strings live in `copy.ts`, Figma tokens in `theme.ts`. Icons in `public/email` (`pnpm email:icons`, Font Awesome Free, CC BY 4.0).
- `src/prisma/`: global `PrismaModule`; inject `PrismaService` anywhere. Client generated into `src/generated/prisma` (ignored by git) by `prisma generate`, which runs before build, dev, test and check-types.
- Local TLS: `validateEdition` only accepts https links, so `WEB_ORIGIN` is https even in development and the site has to answer it — a link the local site could not open would be worse than no link. `pnpm certs` makes a certificate authority of its own and a localhost certificate with openssl, and `pnpm dev` serves them. The API stays http: it never appears in the validated HTML, and a private authority in front of it would only break the call the site makes (Next does not pass `NODE_EXTRA_CA_CERTS` to the process that runs the server).
- `prisma/seed-lab.sql`: three articles already written, put into the day's edition, so the steps after writing can be validated in the lab without paying for a collection and a writing run, and on a fixed input. Not a migration — it sits outside `prisma/migrations/`, so `migrate deploy` never sees it — and it refuses any database that is not `argon_lab` or `argon_dev`. Running it again leaves the same state: whatever was attached to the day's edition and is not from the fixture is detached. Inside the container: `docker compose run --rm --no-deps api-lab sh -c './node_modules/.bin/prisma db execute --file prisma/seed-lab.sql'`.
- `src/settings/`: `settings.schema.ts` is the single source of truth for setting names, types and defaults; what shapes
  the edition — `score_cutoff`, `min_articles`, `max_articles` — defaults from the environment's profile, so no row is
  needed for lab and a development machine to accept a weaker edition. A row still wins: it is how one environment says
  something other than what the profile assumed, and `PATCH /settings { key, value }` is how it is written (`GET
  /settings` reads the table as the pipeline sees it, defaults included). The rest: `SettingsService.load()` reads the table into the typed object (the pipeline loads once per run), `get(key)` re-reads one key, `set(key, value)` is the only write path and validates first. Secrets stay in the environment; template copy and theme stay in code.
- `prisma/schema.prisma`: the application tables from the database diagram, plus `seen_url` (links the collector already evaluated). Check constraints, triggers (`updated_at`, frozen articles after send) and the initial `setting` rows live in the migration SQL, not in the schema.

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
pnpm email:send [to]   # sends the fixture edition through the real transport; locally it lands in Mailpit,
                       # with a working unsubscribe link: the recipient is recorded as a subscriber
pnpm email:icons       # regenerates the social PNGs into apps/web/public/email
```

The images are served by the site, not by the API: `asset_base_url` points at the site's domain in
every environment, and the API has no static route. They live in `apps/web/public/email`, which the
web image copies, so a change only reaches an inbox after the site is deployed. To see them locally,
run the site and point the setting at it:

```bash
docker exec api-db-1 psql -U argon -d argon_dev -c "update setting set value='\"http://localhost:3000/email\"' where key='asset_base_url';"
```

## Conventions

Effect is the standard for typed errors (`Data.TaggedError`), pattern matching (`Match`), retries (`Effect.retry`) and promises (`Effect.tryPromise`). Services return effects; the Nest boundary runs them through `runEffect`, and tools run theirs in `execute`. Never mix try/catch and Effect in the same function.

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
curl -X POST http://localhost:3001/subscriber/confirm -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" -d '{"token":"<confirmation token, from the e-mail>"}'
```

```bash
curl -X POST http://localhost:3001/subscriber/unsubscribe -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" -d '{"token":"<unsubscribe token>"}'
```

```bash
curl -X POST http://localhost:3001/pipeline/write -H "x-internal-secret: $INTERNAL_API_SECRET"
```

```bash
curl -X POST http://localhost:3001/pipeline/build -H "x-internal-secret: $INTERNAL_API_SECRET"
```
