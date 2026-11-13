# api

NestJS with Mastra: sign-up, the agents that write the edition, the e-mail builder and the sending.
In AWS it runs as two Lambda functions per environment, the API and the jobs (`deploy/README.md`).
Source of truth for decisions: the Architecture and Stack documents on OneDrive.

## Layout

- `src/mastra/`: Mastra instance (`index.ts`), the single agent `agents/editor.ts`, `skills/<name>/SKILL.md` (one per pipeline step), `prompts/`, `schemas/`, `tools/`, `workflows/`. The services reach the instance through `MastraInstanceModule` (`mastra.module.ts`, the `MASTRA` token in `token.ts`); the `MastraModule` of `@mastra/nestjs`, which mounts the Mastra routes under `/mastra`, is registered only where `STUDIO_ENABLED` is on — a development machine — so no deployed function has a route to an agent or a workflow.
  `paths.ts` names the folder that is data and not code — the skills — and the Editor's scratch folder. Neither `__dirname` nor the working directory can name them in both runtimes (the Studio runs an ESM bundle from `src/mastra/public`, the API runs CommonJS from `apps/api`), so it climbs from wherever the process started until it finds the Mastra tree, preferring `src` over `dist` — the image carries only `dist`, filled by the nest-cli assets.
  The agent's text lives in the code alone: the instructions in `prompts/editor.ts`, the craft of each step in its `SKILL.md`, the model per step in `MODEL_SELECT` / `MODEL_WRITE`. A change to the agent is a change to those files, reviewed in a PR and deployed with the image. The Studio's **Editor** tab is a scratchpad for trying a change locally: it exists only where the Studio is served, writes to `apps/api/.mastra-editor/` (ignored by git), and what it writes overrides the code on that machine only — once a try is good, its text goes into the files above and the scratch file is deleted.
  `workflows/edition.ts` is the generation as one run — `ingest` → `write` → `build`, two retries each. It is registered on the instance, so the Studio draws it and shows the state of every step; since the instance is built at import time, with no Nest around, the steps reach the application through a port Nest binds at boot (`workflows/context.ts`, `pipeline/port.ts`); `workflows/step.ts` is the shape every step shares, and `workflows/send.ts` the send, for the Studio. `tools/studio.ts` holds the Studio's tools. A step reports failure by throwing, which is what makes Mastra try it again; the services keep speaking Effect.
- `src/ingest/`: the news, listed and judged by code (ARG-123). `POST /pipeline/ingest` is the first step of the
  run; the manual commands run the same code to read the sources of an environment and calibrate the triage. No
  model and no page read:
  every address of every active source — RSS 2.0 or 0.91, Atom, or a news sitemap — is read in
  parallel through the guarded fetch `read_page` also uses (`src/net/fetch.ts`: only the source's
  domain, never a private address, every redirect checked), in the charset the response declares in
  its header or its prolog (Folha's feed is ISO-8859-1; `fetch-feed.ts`, `parse.ts`, `dates.ts`).
  Each item goes through the chain: unwrap a redirector (`url.ts`), canonicalize, the window (24 h,
  48 h on Mondays; a date without offset is São Paulo time, an item without a date is dropped and
  counted), the section rules of its source and the title noise (`source.ts`, `score.ts`), then a
  code score with a reason per point (`triage.ts`: lexicon, weights, cutoff 4, cap 20 — versioned
  here and recalibrated with the commands below). The same fact in several outlets becomes one group
  by a MinHash of the title (`signature.ts`, `group.ts`), represented by the most trusted source, the
  others kept as members, a point per extra outlet; a group like something published or stored in
  the last 3 days is a late copy and is dropped. What passes is a **ficha** in `article`, with no
  edition: link, source, title, date, origin, the feed's text and its kind (`full`, `summary`,
  `none`), members, code score and signals. Every listed link goes to `seen_url` as the sha256 of
  its canonical form — the agent's collection is gone with it. The sources live in the `source` and `source_feed` tables, per environment,
  seeded by the migration with the survey of 29/09/2026 and written only through `GET|POST /sources`,
  `PATCH /sources/:domain` and `POST|DELETE /sources/:domain/feeds` (Zod: https, a name and not an IP, every
  address on the source's domain; before and after in the log). Their active domains are the allowlist of
  `read_page` (`allowlist.ts`), loaded at boot and refreshed by each live ingestion, so a source turned off leaves
  it on the next run. A source whose every address fails three runs in a
  row alerts the owners once, and stays active; a good read resets it. One failing address never
  stops the run; all of them failing fails it. The log has two layers, both with the run id: per
  address and per run always, and per item and group when the `ingest_debug` setting is on. `store.ts` is the contract a run
  reads and writes through (`IngestStore`), over Prisma or in memory; `mode.ts` picks the live world
  or the mocked one — `fixtures/`, an invented world on `.test` domains (feeds, a sitemap, pages, a
  Latin-1 feed behind a redirector, a malformed feed, a source down) served by a network that
  answers only it, whose fichas are real rows.
- `src/pipeline/`: the steps. Errors, retries and outcomes use Effect; a structured answer gets two attempts
  (`src/mastra/attempts.ts`).
  `POST /pipeline/write` then turns the fichas into the edition: `write.ts` opens the day's edition (one row per
  São Paulo calendar day) and takes the fichas of the window, up to the ingestion's cap. The Editor's `select` skill
  triages them all in one generation, before any page is read (`triage.ts`, ARG-124): a focus class — business and
  technology are the core, the market only next to a named business effect, the rest is out — an impact and a score
  from 0 to 5, a one-line reason, and `sameAs` for the rewrites the title signature missed, checked against the
  headlines of the last three days. The code then orders by the model's score with the code's as the tie-break and
  takes as many as the edition holds, plus a reserve of two for a page that will not open or an item rejected twice;
  no cutoff — the day's best are the day's edition, and a thin day is `min_articles`'s business. A mocked run folds
  the code's score instead of asking a model. Every verdict goes to the log. A ficha whose feed did not carry the whole article is read from its page; when that one is
  closed or has no readable text, from the next member of its group, in order; and when none opens, from the feed's lead.
  A ficha with no text at all is left out. The run opens at most `maxReads` pages (`profile.ts`); past that, the feed's
  text is all there is. The edition links the ficha either way; the prompt names the outlet the text was read in. The Editor loads the
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
  because the ingestion window is relative to it, and a run for another day stops before touching anything. A run below
  the minimum ends after the writing: there is no edition to build. The clock lives in Nest and not in
  `createWorkflow({ schedule })` — the declarative schedule only runs on the evented engine, whose pubsub is in memory
  and never started by `@mastra/nestjs` — so `scheduler.ts` fires the run at 5h30, Monday to Saturday, America/Sao_Paulo,
  and only where `SCHEDULER_ENABLED` says so — a development machine that turns it on. In AWS the clock is off and
  EventBridge Scheduler invokes the same methods on the jobs function by name (`jobs.controller.ts`,
  `deploy/aws/lambda.tf`). The per-step routes stay, for debugging.
  Every step runs holding a Postgres advisory lock on the edition's day (`lock.ts`): the 5h30 workflow, a per-step
  route fired by hand and a second process all contend on the database, not on a flag in memory, and a busy edition
  answers 409. `watch.ts` looks at 8h — and, on a long-running process (`SCHEDULER_ENABLED`), also at boot — for an edition left `generating` or `sending` for more than three
  hours — the one failure nothing else reports — logs `edition stuck` (a CloudWatch alarm watches that line) and mails
  the owners; `POST /pipeline/send { "date": "YYYY-MM-DD" }` is how such an edition is resumed after the calendar moved
  on. `retention.ts` trims the tables nightly (see Database).
  `POST /pipeline/send` is the distributor (`delivery.service.ts`), and a run of its own: not a fourth step of the workflow, because the edition
  is ready long before it and a resend generates nothing. `send.ts` reads the built edition — accepting `ready` and also
  `sending`, which is the state a run that stopped halfway leaves and the only way out of — creates one `delivery` row
  per confirmed subscriber as `pending`, and hands them to the provider in batches of 100 under the idempotency key
  `<edition>:<batch>`. The queue is whatever the database calls pending, so running again only picks up what is left; the
  edition closes as `sent` when nothing is pending. `scheduler.ts` fires it at 7h, the same days, behind the same
  `SCHEDULER_ENABLED` (in AWS, the `send` job). Two things to know about what it means: the key the provider dedupes on **expires after 24h**, so
  resuming the same morning is safe and resuming a two-day-old edition would deliver again; and `sent` means the provider accepted the
  message, not that anyone received it: what happened next comes back through the delivery webhook (`src/webhooks/`).
  A batch is all-or-nothing at the row level: either the provider answered and every row moved to `sent` or `failed`, or
  it did not and every row is still `pending`. That is what makes the key honest, and it holds only while batch numbers
  are frozen at creation, a subscriber who confirms later starts a batch of their own, and the rows of a batch keep a
  stable order. A batch refused whole leaves its rows `pending`, never `failed` — `failed` means the provider looked at
  that one message and said no.
  `personalize.ts` is where the stored edition becomes one subscriber's copy: the marker in both copies gives way to
  the subscriber's own unsubscribe token, and the `List-Unsubscribe` headers (RFC 8058) carry the same token. The token
  is derived, never stored — `<subscriber id>.<HMAC-SHA256 of the id under UNSUBSCRIBE_TOKEN_SECRET>`
  (`src/subscriber/token.ts`) — so the sending step asks for it as often as it likes and the database keeps only a
  hash. A copy with no place for the token settles as `failed` without leaving; rotating the secret invalidates
  every link already in an inbox, so it is a deliberate act.
  A failure mails the `owner_emails` from the settings (`owner-alert.ts`) **once**: the alert lives at the boundaries —
  the run, for the step that failed, and each per-step route — never inside a step, where a retry would mail the owners
  once per attempt.
  `profile.ts` is what an environment is willing to pay: `ARGON_ENV` (`local | lab | dev | prod`) picks one row of a
  table in code — how long the text may be, how many pages a run may open, and the defaults for the article bounds.
  The model is not a dial of the profile: every environment runs Haiku on both steps, and `MODEL_SELECT` and
  `MODEL_WRITE` change one step without the other (`src/mastra/models.ts`; the Editor reads the step from the request
  context of each call). Dev reads less and accepts a weaker edition than production; lab and a development machine
  run **over a fixture**, with no model and no network at all. The dials
  are not rules: what an edition may contain stays in `rules.ts` and is the same everywhere. `POST /pipeline/run
{"mode":"live"}` pays for a real run in lab or locally without a deploy, and production refuses `mock` whoever asks.
  A mocked run swaps only where the news comes from (`src/ingest/mode.ts`) and who writes it (`write-mock.ts`); the
  parser, the window, the triage, the groups, the schemas and the transaction are the same code either way, so what it
  proves is the pipeline. The fixture's links (`src/ingest/fixtures/`) carry the day's date so each run ingests fresh
  news instead of finding only seen links — they are on `.test` domains, so the lab edition's links do not open, and the
  text says in every article that it is invented.
- `src/pipeline/jobs.controller.ts`: the jobs by name, on the jobs function only (`JOBS_ENABLED`).
  EventBridge Scheduler invokes it with `{"job": "<name>"}` and the Lambda Web Adapter hands that to
  `POST /events`: `edition`, `send`, `watch`, `retention`, `sunday-edition` and `sunday-send` are the
  methods the internal clock calls; `backup` (`backup.ts`) dumps production to S3,
  `restore-drill` (`restore-drill.ts`) restores the latest dump into a throwaway database once a
  month, and `migrate` (`migrate.ts`) is what the deploy runs before the API function moves. The
  route is public because the adapter posts without the secret; the function has no URL, so only an
  invocation IAM allowed gets there.
- `src/effect/`: `runEffect(step, effect)` is the Nest boundary — controllers hand it an effect and typed failures come back as a 500 carrying the step and the reason. `failureReason(cause)` is what both boundaries, the route and the workflow step, use to say what went wrong.
- `src/subscriber/`: `POST /subscriber { email }` records the sign-up as `pending` with a fresh confirmation token (48h, only the hash is stored). Idempotent by e-mail: a confirmed address is left untouched, a bounced or blocked one is ignored, a cancelled one is reopened, and a pending one confirmed less than a minute ago is left alone (`throttled`) so the link already sent keeps working.
  The proof of opt-in (LGPD), address and user agent, is the request's own (`src/auth/internal-call.ts`): the static
  site calls from the visitor's browser, and nothing in the body speaks for the visitor.
  The confirmation e-mail goes out in the same call. `POST /subscriber/confirm { token }` turns the one-time token into a
  confirmed subscription and issues the permanent unsubscribe token in the same write; the hash of the confirmation token
  is kept, so the same link clicked twice answers `already_confirmed` instead of looking broken.
  Unsubscribing lives here too: `GET /subscriber/unsubscribe?token=…` only says who the token belongs to, so the page can
  confirm first — a GET that cancelled would unsubscribe people on its own, since e-mail clients follow every link they find.
  `POST /subscriber/unsubscribe { token }` cancels, and `POST /subscriber/unsubscribe/one-click?token=…` is the
  public RFC 8058 endpoint the `List-Unsubscribe` header announces. The permanent unsubscribe token is derived from the
  subscriber id and `UNSUBSCRIBE_TOKEN_SECRET` (`token.ts`); the confirmation records only its hash. The service speaks
  Effect end to end — `SubscriberDbFailed` and `ConfirmationMailFailed` are its failures — and the controller runs it
  through `runEffect`, so a provider that is down answers 503 and a database that is down answers 500.
- `src/webhooks/`: `POST /webhooks/resend`, the delivery webhook — the second half of the distributor. Public, because
  the provider cannot send `x-internal-secret`; instead every request carries the Svix signature (`svix-id`,
  `svix-timestamp`, `svix-signature`) over its raw body, checked against `RESEND_WEBHOOK_SECRET` before anything is read
  (`signature.ts`: HMAC-SHA256, five minutes of tolerance on the timestamp, constant-time comparison; `main.ts` keeps the
  raw body for it). A bad signature answers 401 and changes nothing. The route exists only where the secret is set.
  The event is matched to its `delivery` row by `provider_email_id` (`delivery-event.ts`, `delivery-webhook.service.ts`):
  `email.delivered` → `delivered`; `email.bounced` → `hard_bounce` if `Permanent`, otherwise `soft_bounce`;
  `email.complained` → `complaint`; `email.suppressed` → `hard_bounce`; `email.failed` → `failed`. The rest (sent, delayed,
  opened, clicked) is logged and ignored. On the subscriber, a hard bounce marks them `bounced` (unless already `blocked`),
  a complaint `blocked`, and a soft bounce adds one to `soft_bounces` — counted, not acted on: how many soft bounces give up
  on an address is not decided yet. The row only moves forward: each event may move it only from the statuses listed in
  `transitionFor`, with a conditional update in the same transaction as the subscriber's change, so an event received twice
  or late applies once and never moves a final status back. An id no delivery carries is logged as `delivery webhook` with
  `outcome: "unknown"`: while the event is less than 15 minutes old it answers 409, so the provider retries — the sending
  step stores the ids only when the provider has answered the whole batch, and a failure or a suppression can arrive
  before that; after that it answers 200 (a confirmation e-mail, an edition already trimmed). A database failure answers
  500, which the provider also retries. A hard bounce marks a `cancelled` subscriber `bounced` too: the address is dead. Registering the endpoint in Resend is done by hand, once per environment:
  `<API_ORIGIN>/webhooks/resend`, with the e-mail events; its signing secret goes to `/argon/<env>/RESEND_WEBHOOK_SECRET`.
- `src/auth/`: global guard; every route needs the `x-internal-secret` header unless marked `@Public()`.
  `signup-throttle.guard.ts` rate-limits every public subscriber route by the visitor's address (`req.ip`, which the
  API function takes from `CloudFront-Viewer-Address`, `src/net/cloudfront.ts`): ten a minute, in memory.
- `src/subscriber/urls.ts`: every address the subscriber reaches from an e-mail — the confirmation page, the unsubscribe
  page for the footer link, and the API endpoint the `List-Unsubscribe` header announces. The builders receive them ready
  (they build no URL), so this is where the format is decided. The origins are bound once in `SubscriberModule.forRoot`.
- `src/subscriber/confirmation-mail.ts`: composes the sign-up confirmation (sender from `MailService.sender()`, links from the origins) and sends it. A provider
  failure clears the send mark before it propagates, or the resend window would block the retry over an e-mail that never
  left.
- `src/mail/`: the only way out of the API. `MailService.sender()` signs with the name and postal address of the `sender`
  setting and the environment's `MAIL_FROM`, and `send()` fills `from` with it; which provider delivers is bound in `MailModule.forRoot` by `MAIL_TRANSPORT` — `ResendTransport` with the
  injected Resend client in AWS, `SmtpTransport` pointing at the local Mailpit otherwise. Resend is never the default, so
  no development machine reaches a real inbox by accident.
- `src/config.ts`: environment validated with Zod. Names match the Parameter Store keys under `/argon/<env>/`.
- `src/email/`: deterministic e-mail builder. `buildEdition(input)` returns `{ subject, html, text }` from structured content, no LLM, no I/O; `validateEdition` is the mechanical check (parseable HTML, no script, images https and under the allowed base, stylesheet on the allowlist, every item link present in both formats, unsubscribe and postal address present, size and length limits). `toEditionInput` adapts `edition` + `article` rows; `editionContext({ sender, social }, { origins, unsubscribeUrl })` builds the rest: the sender and the networks as given, the privacy policy and the site from the environment's `WEB_ORIGIN` (`privacyPolicyUrl`, `socialLinks` in `src/subscriber/urls.ts`), with the unsubscribe URL per subscriber. Nothing that names a host lives in the settings, so a fresh database cannot point one environment's e-mail at another. `assets.ts` derives the base of the images (the public bucket under the environment's prefix, or the site on a local machine, or `PUBLIC_ASSETS_ORIGIN`), and `EmailAssets` checks at boot that they are really served. Fixed strings live in `copy.ts`, the brand tokens (argon lilac, Manrope with Geist Mono, square corners) in `theme.ts`. Images in `web/public/email`: the header symbol and ARGON, the footer logo, and the social icons (`pnpm email:icons`, Font Awesome Free, CC BY 4.0). A social network with no URL in `social` points at the site.
- `src/prisma/`: global `PrismaModule`; inject `PrismaService` anywhere. Client generated into `src/generated/prisma` (ignored by git) by the turbo task `generate` (`prisma generate`), which build, dev, lint, test and check-types depend on — the typed lint needs it too. Turbo runs it once per invocation, before the tasks that need it, and replays it from cache while `schema.prisma` and `prisma.config.ts` are unchanged: one writer, where a `pre*` hook on every script had parallel tasks writing the same folder at once. A script called straight in the package (`pnpm -C apps/api test`, the Dockerfile's build) skips turbo, so run `pnpm -C apps/api generate` first; `prisma migrate dev` regenerates on its own.
- Local TLS: `validateEdition` only accepts https links, so `WEB_ORIGIN` is https even in development and the site has to answer it — a link the local site could not open would be worse than no link. `pnpm certs` makes a certificate authority of its own and a localhost certificate with openssl, and `pnpm dev` serves them. The API stays http: it never appears in the validated HTML, and a private authority in front of it would only break the call the site makes (Next does not pass `NODE_EXTRA_CA_CERTS` to the process that runs the server).
- `prisma/seed-lab.sql`: three articles already written, put into the day's edition, so the steps after writing can be validated in the lab without paying for a collection and a writing run, and on a fixed input. Not a migration — it sits outside `prisma/migrations/`, so `migrate deploy` never sees it — and it refuses any database that is not a test one: on Neon, any branch but lab's and dev's (every branch names its database `argon`); locally, any database but `argon_lab` or `argon_dev`. Running it again leaves the same state: whatever was attached to the day's edition and is not from the fixture is detached. From a machine, with the lab URL: `DATABASE_URL='<value of /argon/lab/DATABASE_URL>' pnpm -C apps/api exec prisma db execute --file prisma/seed-lab.sql`.
- `src/settings/`: `settings.schema.ts` is the single source of truth for setting names, types and defaults; what shapes
  the edition — `min_articles`, `max_articles` — defaults from the environment's profile, so no row is
  needed for lab and a development machine to accept a weaker edition. A row still wins: it is how one environment says
  something other than what the profile assumed, and `PATCH /settings { key, value }` is how it is written (`GET
/settings` reads the table as the pipeline sees it, defaults included). The rest: `SettingsService.load()` reads the table into the typed object (the pipeline loads once per run), `get(key)` re-reads one key, `set(key, value)` is the only write path and validates first. Secrets stay in the environment; template copy and theme stay in code.
- `prisma/schema.prisma`: the application tables from the database diagram, plus `seen_url` (the hash of every link an ingestion or the collector already evaluated) and the `source` and `source_feed` tables of the ingestion. Check constraints, triggers (`updated_at`, frozen articles after send) and the initial `setting` rows live in the migration SQL, not in the schema.

## Run

```bash
pnpm db:up             # local Postgres 16 with pgvector and Mailpit (Docker); inbox at http://localhost:8025
cp .env.example .env   # fill ANTHROPIC_API_KEY and INTERNAL_API_SECRET
pnpm dev               # http://localhost:3001; with STUDIO_ENABLED=true, the Studio at /studio
pnpm db:pull           # the news of dev (sources, feeds, editions, articles, seen links) into the local database
pnpm test
pnpm email:preview     # out/email-preview*.html and .txt from the fixtures, images inlined, for the visual review
```

## Ingestion

Manual commands, to look at the sources and calibrate the triage. They wire the database and the
network by hand, without Nest; `--mock` reads the fixture, and `--mock --dry-run` needs no database.

```bash
pnpm ingest:sources                 # sources and addresses of DATABASE_URL, with their health
pnpm ingest:feed <url>              # one address: every item, its date, window, score or discard reason
pnpm ingest:page <url>              # one page: what the extraction gets out of it
pnpm ingest:run                     # the ingestion, live, writing fichas and seen links
pnpm ingest:run --dry-run           # the same, writing nothing
pnpm ingest:run --ignore-seen       # judge again what earlier runs listed (recalibration)
pnpm ingest:run --mock --dry-run --date 2026-09-30T08:30:00Z
pnpm ingest:run --source valor.globo.com --json --report out/ingest.json
```

The same run by HTTP, in an environment: `mode`, `dryRun`, `ignoreSeen` and `source` as in the
command, the answer being the counts per address.

```bash
curl -X POST http://localhost:3001/pipeline/ingest -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" -d '{"mode":"mock"}'
curl -X POST http://localhost:3001/pipeline/ingest -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" -d '{"mode":"live","dryRun":true}'
curl http://localhost:3001/sources -H "x-internal-secret: $INTERNAL_API_SECRET"
curl -X PATCH http://localhost:3001/sources/exame.com -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" -d '{"active":false}'
```

```text
run 7d0c… (dry run) — 2026-09-30T08:30:00.000Z, window from 2026-09-29T08:30:00.000Z
5 sources, 26 listed, 22 in the window, 17 candidates, 15 groups
0 fichas stored, 0 already there, 5 below the cutoff, 0 over the cap, 1 late copies
failed sources: fonte-fora-do-ar.test
== addresses
source                  ok    status  listed  inWindow  candidates  dropped                      error
diario-ficticio.test    ok    200     8       7         5           discarded:2 out_of_window:1
diario-ficticio.test    FAIL          0       0         0                                        FeedMalformed: invalid xml…
portal-exemplo.test     ok    200     8       6         4           discarded:2 out_of_window:1 future:1
fonte-fora-do-ar.test   FAIL  503     0       0         0                                        FetchFailed: HTTP 503
== groups (fichas first)
outcome       score  source              also               title
ficha         9      Agência Inventada   Diário Fictício  Copom mantém a Selic e o crédito às empresas segue caro
```

## Studio

The Studio is a development machine's tool. With `STUDIO_ENABLED=true` in `.env`, `pnpm dev` serves it
at <http://localhost:3001/studio>, together with the Mastra routes it calls under `/mastra`. Every
deployed function runs with `STUDIO_ENABLED=false` (`deploy/aws/lambda.tf`): no Studio, no `/mastra`, no
Editor, no traces.

In AWS, Mastra is not a service of its own: it is a library inside this same Nest process. The jobs
function gets `{"job":"edition"}` from EventBridge, the Lambda Web Adapter turns it into
`POST /events`, and the job runs the `edition` workflow in the process, step by step, until it is
done. So a local run is the same code a Lambda runs; what differs is the configuration (`.env` instead
of the Parameter Store), the database, and what only a Lambda has — the 900 s ceiling, the freeze once
the answer is sent, the read-only disk, the cold start. Those are seen in dev, by invoking the jobs
function (`deploy/README.md`).

### The work loop

1. **Data.** `pnpm db:pull` copies the news of dev into the local database: sources, feeds, editions,
   articles and seen links — not subscribers, deliveries or settings, and not the `mastra` schema
   (`scripts/db-pull.ts`). It reads `/argon/dev/DATABASE_URL` from the Parameter Store with the shell's
   AWS profile (`AWS_PROFILE=argon-new`), or `PULL_DATABASE_URL`; `pnpm db:pull --check` does everything
   but the copy. The two databases must be on the same migration: the local one is migrated first, and
   a source ahead or behind stops the command. The articles keep their text until their edition is
   sent, so the recent days are the ones worth writing from. With the fixture instead (`mode: mock`),
   nothing needs pulling.
2. **Change the agent in the code.** The instructions are `src/mastra/prompts/editor.ts`, the craft of
   each step its `SKILL.md`, the model per step `MODEL_SELECT` / `MODEL_WRITE`; `pnpm dev` picks a
   change up on its own. The Editor tab is a scratchpad: what it writes goes to `.mastra-editor/`,
   ignored by git, and overrides the code on this machine only — move the text that works into the
   files above and delete the scratch file.
3. **Run it.** Workflows → `edition` → Run, with `date` and `mode` optional (empty: today, the
   profile's mode, which is `mock` locally). `send` sends the built edition (to Mailpit, locally). Each
   step reads the services through the port Nest binds at boot (`src/mastra/workflows/context.ts`,
   `src/pipeline/port.ts`), so a run from the Studio does what the job does, alerts included: a step
   that gives up mails the owners once, on its last attempt (`src/mastra/workflows/step.ts`).
4. **Look.** A `live` run leaves a trace under Observability, with each of the Editor's calls nested
   under its step, and every written item gets a `hallucination-scorer` score (0 is faithful to its
   article, 1 is invented). Tools: `edition_html` (the stored e-mail of a day), `delivery_status`
   (where a day's delivery stands), `dataset_add_day`.
5. **Compare.** `dataset_add_day` puts a day's articles into the `write` dataset, each as the exact
   prompt the writing step gives the Editor. Datasets → write → run an experiment on the `editor`
   agent before and after a change, and compare the scores item by item (Experiments → Compare).
6. **Ship.** The change is files: commit, PR to `dev`, and invoke dev's jobs function to see it on a
   Lambda before `main`.

The traces and the scores come from `@mastra/observability` and `@mastra/evals`, development
dependencies loaded by `require` only where the Studio is served (`src/mastra/studio-extras.ts`): the
image does not carry them, and no deployed database keeps token cost.

### Serving it

The Studio and the routes it calls share one origin — `/studio` and `/mastra` on the same host — so the
browser calls the API same-origin. A browser cannot put `x-internal-secret` on a navigation, so the
bundle under `/studio` is the one public thing here; everything under `/mastra` still answers 401
without the header. The instance URL and the API prefix are already filled by the page
(`src/studio/studio.html.ts`); the secret, `INTERNAL_API_SECRET` from `.env`, goes into the Studio's
Settings, as a header.

One Mastra route answers without the secret where the Studio is served — `GET /mastra/auth/capabilities`,
which the Studio asks before it renders anything and which tells whether Mastra's own auth is on
(`{"enabled":false,"login":null}`). Without that exception the page is a dead error screen, Settings
included, and there is nowhere to type the secret (`src/studio/studio.paths.ts`).

The static files come from the `mastra` CLI, a devDependency, read straight out of `node_modules`
(`src/studio/studio.service.ts`). The image installs production dependencies only and carries no
bundle.

## E-mail

```bash
pnpm email:send [to]   # sends the fixture edition through the real transport; locally it lands in Mailpit,
                       # with a working unsubscribe link: the recipient is recorded as a subscriber
pnpm email:icons       # regenerates the social PNGs into apps/web/public/email
```

The API has no static route and mail clients accept neither SVG nor relative paths, so every image
is an absolute URL (`src/email/assets.ts`). They live in `apps/web/public/email`. A deployed
environment reads them from the public bucket, under its own prefix, which the deploy fills before
it moves the functions (`deploy/aws/README.md`, "Arquivos públicos"); a local machine reads them from
the site, `WEB_ORIGIN` + `/email`. Locally that means `pnpm dev` in `apps/web` and nothing else; a
`WEB_ORIGIN` with no site behind it mails broken images. `PUBLIC_ASSETS_ORIGIN` overrides both.

Which is what `EmailAssets` says, at every boot, in one line per state:

```
LOG   [EmailAssets] { msg: 'email assets ok', base: 'https://argon-public-382597877834.s3.sa-east-1.amazonaws.com/lab/email', count: 6 }
ERROR [EmailAssets] { msg: 'email assets unreachable', base: '...', broken: [{ url: '.../logo.png', ok: false, detail: '404 text/html' }] }
```

A 404 answered by a 404 page counts as broken: the check wants a 2xx _and_ an
`image/*`. It never blocks the boot — an image out of the air is no reason to take the API down.

## Conventions

Effect is the standard for typed errors (`Data.TaggedError`), pattern matching (`Match`), retries (`Effect.retry`) and promises (`Effect.tryPromise`). Services return effects; the Nest boundary runs them through `runEffect`, and tools run theirs in `execute`. Never mix try/catch and Effect in the same function.

## Database

Every schema change is a new migration under `prisma/migrations/`, named by timestamp, and the init
migration is frozen: dev, lab and prod all carry it applied. What the schema cannot express — check
constraints, triggers, partial indexes, seed rows — goes in the migration's SQL by hand, with a
comment saying why, and a line in `schema.prisma` pointing at it.

```bash
pnpm db:migrate --name <what_changed>   # edit schema.prisma first; writes and applies the SQL locally
pnpm db:deploy     # applies pending migrations only (what the deploy's migrate job runs in AWS)
pnpm db:reset      # drops the local database and replays everything, seed rows included
pnpm db:studio     # browse the local database
```

Migrations run before the API function moves to the new image and never run backwards, so every one has to be
compatible with the code already running: expand first (a new column, a new table), contract later
(drop the old one), in separate deploys.

Retention runs at 4h every day (`src/pipeline/retention.ts`) — the `retention` job of the jobs function in AWS, the
internal clock behind `SCHEDULER_ENABLED` on a machine that turns it on:
the text of an article is cleared after 30 days, a seen link is forgotten after 30, and a cancelled
subscriber is purged after 90, and a sign-up nobody confirmed is discarded 3 days after its link
expired — in batches of a thousand, so a table that grew for months is trimmed without holding a
lock. Bounced and blocked addresses stay, so they are never written to again.

Every deploy runs `prisma migrate deploy` from the API image, as the jobs function's `migrate` job (`src/pipeline/migrate.ts`), before the API function moves, so lab, dev and prod are migrated by the pipeline; never edit a deployed schema by hand. The database of each environment is a Neon branch (`deploy/README.md`, "Banco"). Mastra keeps its own tables in the `mastra` schema, outside Prisma.

The subscriber routes are public, as the site calls them from the browser:

```bash
curl -X POST http://localhost:3001/subscriber -H "content-type: application/json" -d '{"email":"someone@example.com"}'
```

```bash
curl -X POST http://localhost:3001/subscriber/confirm -H "content-type: application/json" -d '{"token":"<confirmation token, from the e-mail>"}'
```

```bash
curl -X POST http://localhost:3001/subscriber/unsubscribe -H "content-type: application/json" -d '{"token":"<unsubscribe token>"}'
```

```bash
curl -X POST http://localhost:3001/pipeline/write -H "x-internal-secret: $INTERNAL_API_SECRET"
```

```bash
curl -X POST http://localhost:3001/pipeline/build -H "x-internal-secret: $INTERNAL_API_SECRET"
```

```bash
curl -X POST http://localhost:3001/pipeline/send -H "x-internal-secret: $INTERNAL_API_SECRET"
```
