# api

NestJS with Mastra. Runs the newsletter agents and, later, sign-up, cron, queues and sending. Source of truth for decisions: the Architecture and Stack documents on OneDrive.

## Layout

- `src/mastra/`: Mastra instance (`index.ts`), the single agent `agents/editor.ts`, `skills/<name>/SKILL.md` (one per pipeline step, copied to `dist` by nest-cli assets), `prompts/`, `schemas/`, `tools/`. `MastraModule` is imported last and mounted under `/mastra`.
- `src/pipeline/`: the steps. `POST /pipeline/collect` runs the `collect` skill: the Editor searches the sources, reads pages and scores; `persist.ts` then applies allowlist, window and cutoff and stores what passes under the page's own canonical URL, marking every evaluated link in `seen_url`. `rules.ts` holds the one list of sources — it feeds the search allowlist, the persistence check and the step prompt, so the skill never repeats it — plus the window, the search and step ceilings and the text limit. The structured answer gets two attempts (`src/mastra/attempts.ts`), and a step that fails mails the `owner_emails` from the settings (`owner-alert.ts`). Errors, retries and outcomes use Effect.
  `POST /pipeline/write` then turns what was stored into the edition: `write.ts` opens the day's edition (one row per
  São Paulo calendar day), takes the articles above the cutoff still free of an edition, and the Editor loads the
  `write` skill once per article — two attempts each, the second carrying the validation error. An article rejected
  twice leaves the edition and the others go on; the header (title and subject) is a generation of its own over what
  was approved. Saving is one transaction that detaches whatever an earlier run left attached, so the step can run
  again without growing the edition. Fewer than `min_articles` written and the edition becomes `skipped` with an
  alert to the owners — better no edition than a weak one; but a thin run never downgrades an edition an earlier run
  of the same day already wrote (`belowMinimum`): it fails instead, and the complete edition stands. The skill holds
  the craft; categories and lengths travel from the schema into the step prompt, never into the skill.
- `src/effect/`: `runEffect(step, effect)` is the Nest boundary — controllers hand it an effect and typed failures come back as a 500 carrying the step and the reason.
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
- `src/settings/`: `settings.schema.ts` is the single source of truth for setting names, types and defaults; `SettingsService.load()` reads the table into the typed object (the pipeline loads once per run), `get(key)` re-reads one key, `set(key, value)` is the only write path and validates first. Secrets stay in the environment; template copy and theme stay in code.
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
