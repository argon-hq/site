import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Agent } from "@mastra/core/agent";
import { MastraService } from "@mastra/nestjs";
import { RequestContext } from "@mastra/core/request-context";
import { Data, Effect } from "effect";
import { CONFLICT, UNPROCESSABLE, type Failure } from "../effect/failure";
import type { z } from "zod";
import { editionHeaderSchema, writtenItemSchema, type EditionHeader } from "../mastra/schemas/edition";
import type { EditionContext } from "../mastra/workflows/context";
import { editionRunSchema, type EditionRun } from "../mastra/workflows/edition";
import { allowedDomains, isAllowedDomain, setAllowedDomains } from "../ingest/allowlist";
import { fetchFeed } from "../ingest/fetch-feed";
import { fixtureAllowed, fixtureDeps } from "../ingest/fixtures";
import { ingest, type IngestReport } from "../ingest/ingest";
import { ingestWorld } from "../ingest/mode";
import { fetchArticle } from "../mastra/tools/read-page";
import { buildEdition, editionContext, toEditionInput, validateEdition } from "../email";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { ORIGINS, unsubscribePlaceholderUrl, type Origins } from "../subscriber/urls";
import { buildReason, loadEdition, saveBuilt } from "./build";
import { generateStructured } from "./generate";
import { DeliveryService, SendFailed, type SendReport } from "./delivery.service";
import { EditionBusy, EditionLock, LockDbFailed } from "./lock";
import { OwnerAlert } from "./owner-alert";
import { DEPLOYMENT, resolveMode, type Mode } from "./profile";
import { runDate, runFailure } from "./run";
import { editionDate, windowStart } from "./rules";
import { mockHeader, mockItem } from "./write-mock";
import {
  belowMinimum,
  ItemFailed,
  fillEdition,
  hydrate,
  openEdition,
  saveEdition,
  selectFichas,
  skipEdition,
  sumUsage,
  writeHeader,
  writeItem,
  type Generate,
  type ItemResult,
  type WrittenResult,
} from "./write";

// Every step failure carries a reason and, when the caller is the one to act, the HTTP status that
// says so (see src/effect/failure.ts).
export class IngestStepFailed extends Data.TaggedError("IngestStepFailed")<Failure> {}
export class WriteFailed extends Data.TaggedError("WriteFailed")<Failure> {}
export class BuildFailed extends Data.TaggedError("BuildFailed")<Failure> {}
// A failed run says which step failed, so the single alert it sends is addressed.
export class RunFailed extends Data.TaggedError("RunFailed")<{ step: string; reason: string; status?: HttpStatus }> {}

export type { IngestReport } from "../ingest/ingest";

export type WriteReport = {
  date: string;
  editionId: string;
  status: "written" | "skipped";
  since: string;
  cutoff: number;
  minArticles: number;
  maxArticles: number;
  header: EditionHeader | null;
  items: ItemResult[];
  written: number;
  rejected: number;
  usage: Record<string, number>;
  durationMs: number;
};

export type BuildReport = {
  date: string;
  editionId: string;
  status: "ready";
  subject: string;
  items: number;
  htmlBytes: number;
  textBytes: number;
  durationMs: number;
};

export type RunReport = EditionRun & { runId: string; durationMs: number };

// What a step is told before it starts: which clock to read and whether this run pays for judgement
// or works over the fixture. Both have a default, so a step can still be called bare in a test. The
// run id, when the step is part of a workflow run, goes into every line it logs.
export type StepRun = { mode?: Mode; now?: Date; runId?: string };

// The send may name the edition it is for. Without a date it is today's, as the 7h clock means it;
// with one it is a resume — an edition a run left `sending` and the calendar has moved past.
export type SendRun = StepRun & { date?: Date };

export { SendFailed, type BatchOutcome, type SendReport } from "./delivery.service";

const startOf = (p: StepRun) => ({ mode: resolveMode(DEPLOYMENT, p.mode), now: p.now ?? new Date() });

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  // One generation at a time. The process is single, so a flag is enough to keep the 5h30 run and a
  // run someone fired by hand from working on the same edition at once.
  private inFlight = false;

  // One send at a time, for the same reason: two overlapping sends would read the same pending rows
  // and build the same batches. The idempotency keys would still spare the subscribers, but the rows
  // would be written twice over. The send itself lives in DeliveryService; this is the gate.
  private sending = false;

  constructor(
    private readonly mastra: MastraService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly alert: OwnerAlert,
    @Inject(ORIGINS) private readonly origins: Origins,
    private readonly lock: EditionLock,
    private readonly delivery: DeliveryService,
  ) {}

  // Every step runs holding the day's lock (see EditionLock): a busy edition is a failure of the
  // step, in the step's own words, so the route and the alert read it like any other.
  private locked<A, E extends Failure>(
    day: string,
    step: string,
    body: Effect.Effect<A, E>,
    fail: (failure: Failure) => E,
  ): Effect.Effect<A, E> {
    return this.lock.hold(day, step, body).pipe(
      Effect.catchIf(
        (error): error is EditionBusy | LockDbFailed => error instanceof EditionBusy || error instanceof LockDbFailed,
        (error) =>
          Effect.fail(
            fail(error instanceof EditionBusy ? { reason: error.reason, status: CONFLICT } : { reason: error.reason }),
          ),
      ),
    );
  }

  // Ingestion step: no model and no page read. The active sources' feeds and news sitemaps are
  // listed, filtered, scored, grouped and cut by code, and what passes is stored as fichas for the
  // writing step (and, from ARG-124, for the model's triage). A mocked run reads the fixture's
  // invented sources through a network that answers only them; everything else is the same code.
  ingest(run: StepRun = {}): Effect.Effect<IngestReport, IngestStepFailed> {
    const { mode, now } = startOf(run);
    const runId = run.runId ?? randomUUID();
    const body = Effect.gen(this, function* () {
      const settings = yield* Effect.tryPromise({
        try: () => this.settings.load(),
        catch: (error) => new IngestStepFailed({ reason: `settings: ${String(error)}` }),
      });
      const world = ingestWorld(mode, this.prisma, now);
      return yield* ingest(
        { runId, now, since: windowStart(now), debug: settings.ingest_debug },
        {
          ...world,
          fetchFeed,
          logger: this.logger,
          // A source failing three runs in a row is news for the owners even when the run goes on.
          alert: (reason) => this.alert.send("ingest", reason),
          // A live run is where the allowlist of `read_page` follows the table; a mocked one reads
          // invented sources and leaves it alone.
          onSources: mode === "live" ? (sources) => setAllowedDomains(sources.map((s) => s.domain)) : undefined,
        },
      ).pipe(Effect.mapError((error) => new IngestStepFailed({ reason: error.reason })));
    });
    return this.locked(runDate(now), "ingest", body, (failure) => new IngestStepFailed(failure)).pipe(
      // The alert is not here: with a retry per step, alerting inside the step would mail the owners
      // once per attempt. The run alerts once when the workflow gives up, and the per-step route
      // alerts for its own step.
      Effect.tapError((e) => Effect.sync(() => this.logger.error({ msg: "ingest failed", runId, reason: e.reason }))),
    );
  }

  // Writing step: the Editor loads the `write` skill and writes one article at a time, then the
  // edition header over what was approved. Until the model's triage (ARG-124), the fichas are taken
  // by the ingestion's score, and a ficha whose feed carried no whole text is read from its page,
  // with the feed's lead as the fallback.
  write(run: StepRun = {}): Effect.Effect<WriteReport, WriteFailed> {
    const { mode, now } = startOf(run);
    const body = Effect.gen(this, function* () {
      const startedAt = Date.now();
      const settings = yield* Effect.tryPromise({
        try: () => this.settings.load(),
        catch: (error) => new WriteFailed({ reason: `settings: ${String(error)}` }),
      });
      const date = editionDate(now);
      const day = date.toISOString().slice(0, 10);
      const since = windowStart(now);
      const failed = (error: Failure) => new WriteFailed({ reason: error.reason, status: error.status });

      const edition = yield* openEdition(this.prisma, date).pipe(Effect.mapError(failed));
      const fichas = yield* selectFichas(this.prisma, {
        editionId: edition.id,
        since,
        max: settings.max_articles,
      }).pipe(Effect.mapError(failed));
      // The page is read in the run's world: the sources' web when live, the fixture's when mocked.
      const read =
        mode === "mock"
          ? (url: string) => fetchArticle(url, fixtureDeps(now), fixtureAllowed)
          : (url: string) => fetchArticle(url, undefined, isAllowedDomain);
      this.logger.log({
        msg: "write started",
        mode,
        date: day,
        edition: edition.id,
        fichas: fichas.length,
        allowlist: allowedDomains().length,
      });

      // One generation with a schema: the Mastra promise becomes an effect carrying its reason, so
      // the second attempt can quote what the first got wrong. Writing loads its skill through the
      // `skill` tool, so it works and takes shape in two calls (see `generateStructured`).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the registry types its agents with `any`
      const editor: Agent = this.mastra.getAgent("editor");
      const generating =
        <S extends z.ZodType>(schema: S): Generate<z.infer<S>> =>
        (text) =>
          Effect.tryPromise({
            try: async () => {
              const generated = await generateStructured(editor, text, { schema });
              return { object: generated.object, usage: generated.usage };
            },
            catch: (error) => new ItemFailed({ reason: String(error) }),
          });

      // A mocked run writes from the article itself. The step builds one generation per article, so
      // the mock closes over what it is writing about; everything after it is unchanged, schema and
      // transaction included.
      // The fichas are the pool: one that has no text or fails its two attempts leaves its place to
      // the next, until the edition is full or the pool runs out.
      const { items, tried } = yield* fillEdition(
        fichas,
        settings.max_articles,
        (ficha) => hydrate(ficha, read, this.logger),
        (candidate) =>
          writeItem(candidate, mode === "mock" ? mockItem(candidate) : generating(writtenItemSchema), this.logger),
      );
      this.logger.log({ msg: "fichas tried", date: day, tried, of: fichas.length });
      const written = items.filter((item): item is WrittenResult => item.outcome === "written");

      const report = (status: WriteReport["status"], header: EditionHeader | null, usage: unknown[]): WriteReport => ({
        date: day,
        editionId: edition.id,
        status,
        since: since.toISOString(),
        cutoff: settings.score_cutoff,
        minArticles: settings.min_articles,
        maxArticles: settings.max_articles,
        header,
        items,
        written: written.length,
        rejected: items.length - written.length,
        usage: sumUsage(usage),
        durationMs: Date.now() - startedAt,
      });

      // Better no edition than a weak one: below the minimum nothing is written and the owners hear
      // about it. This is an outcome of the step, not a failure of it — unless an earlier run of the
      // day already wrote the edition, and then the thin run fails and leaves that one alone.
      const short = `ended with ${written.length} valid article(s), below the minimum of ${settings.min_articles}`;
      const outcome = belowMinimum({
        written: written.length,
        min: settings.min_articles,
        alreadyWritten: edition.alreadyWritten,
      });

      if (outcome === "keep_previous") {
        return yield* new WriteFailed({
          reason: `edition ${day} was already written and this run ${short}; the earlier edition stands`,
          status: CONFLICT,
        });
      }
      if (outcome === "skip") {
        yield* skipEdition(this.prisma, edition.id, now).pipe(Effect.mapError(failed));
        this.logger.warn({ msg: "edition skipped", date: day, written: written.length, min: settings.min_articles });
        yield* this.alert.send("write", `edition ${day} ${short}`);
        return report(
          "skipped",
          null,
          written.map((item) => item.usage),
        );
      }

      const writtenItems = written.map((item) => item.item);
      const header = yield* writeHeader(
        writtenItems,
        mode === "mock" ? mockHeader(writtenItems, day) : generating(editionHeaderSchema),
        this.logger,
      ).pipe(Effect.mapError(failed));

      yield* saveEdition(this.prisma, {
        editionId: edition.id,
        header: header.object,
        written: written.map(({ id, item, score }) => ({ id, item, score })),
      }).pipe(Effect.mapError(failed));

      const done = report("written", header.object, [...written.map((item) => item.usage), header.usage]);
      this.logger.log({
        msg: "write finished",
        mode,
        date: day,
        subject: done.header?.subject,
        written: done.written,
        rejected: done.rejected,
        durationMs: done.durationMs,
        usage: done.usage,
      });
      return done;
    });
    return this.locked(runDate(now), "write", body, (failure) => new WriteFailed(failure)).pipe(
      Effect.tapError((error) => Effect.sync(() => this.logger.error({ msg: "write failed", reason: error.reason }))),
    );
  }

  // Building step: no model, no judgement. The rows the writing step left become the HTML and the
  // plain text the sending step carries, and nothing is stored until the mechanical validation
  // passes. Same edition in, same e-mail out.
  build(run: StepRun = {}): Effect.Effect<BuildReport, BuildFailed> {
    const { now } = startOf(run);
    const body = Effect.gen(this, function* () {
      const startedAt = Date.now();
      const settings = yield* Effect.tryPromise({
        try: () => this.settings.load(),
        catch: (error) => new BuildFailed({ reason: `settings: ${String(error)}` }),
      });
      const date = editionDate(now);
      const day = date.toISOString().slice(0, 10);

      const written = yield* loadEdition(this.prisma, date).pipe(
        Effect.mapError((error) => new BuildFailed({ reason: error.reason, status: error.status })),
      );
      this.logger.log({ msg: "build started", date: day, edition: written.id, articles: written.articles.length });

      // One edition for everyone, so the stored HTML carries the unsubscribe placeholder; the
      // sending step swaps it for each subscriber's token.
      const context = editionContext(settings, {
        assetsOrigin: this.origins.assets,
        unsubscribeUrl: unsubscribePlaceholderUrl(this.origins),
      });
      const built = yield* toEditionInput(written.edition, written.articles, context).pipe(
        Effect.flatMap((input) =>
          buildEdition(input).pipe(Effect.flatMap((edition) => validateEdition(input, edition))),
        ),
        // What the builder refuses is the edition's fault, and says so with a 422.
        Effect.mapError((error) => new BuildFailed({ reason: buildReason(error), status: UNPROCESSABLE })),
      );

      yield* saveBuilt(this.prisma, { editionId: written.id, html: built.html, text: built.text }).pipe(
        Effect.mapError((error) => new BuildFailed({ reason: error.reason })),
      );

      const report: BuildReport = {
        date: day,
        editionId: written.id,
        status: "ready",
        subject: built.subject,
        items: written.articles.length,
        htmlBytes: Buffer.byteLength(built.html, "utf8"),
        textBytes: Buffer.byteLength(built.text, "utf8"),
        durationMs: Date.now() - startedAt,
      };
      this.logger.log({ msg: "build finished", ...report });
      return report;
    });
    return this.locked(runDate(now), "build", body, (failure) => new BuildFailed(failure)).pipe(
      Effect.tapError((error) => Effect.sync(() => this.logger.error({ msg: "build failed", reason: error.reason }))),
    );
  }
  // Sending step: no model and no judgement, like the building step. The edition the building step
  // left becomes one message per confirmed subscriber, handed to the provider in batches. It is a
  // run of its own, at 7h, and not a fourth step of the generation workflow: the edition is ready
  // long before it, and a resend has nothing to do with generating anything.
  send(run: SendRun = {}): Effect.Effect<SendReport, SendFailed> {
    const { now } = startOf(run);
    const date = run.date ?? editionDate(now);
    const day = date.toISOString().slice(0, 10);
    return Effect.suspend(() => {
      if (this.sending) return new SendFailed({ reason: "a send is already in flight", status: CONFLICT });
      this.sending = true;
      return this.locked(day, "send", this.delivery.send(date, now), (failure) => new SendFailed(failure)).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.sending = false;
          }),
        ),
        // No alert here: the route and the 7h cron each add their own, so one failure is one e-mail.
        Effect.tapError((error) => Effect.sync(() => this.logger.error({ msg: "send failed", reason: error.reason }))),
      );
    });
  }

  // The whole generation as one run of the `edition` workflow: ingest → write → build, each step
  // with its own retry and its own state in the Studio. The steps have no Nest injection, so the run
  // hands them this service through the request context — the same deal the tools have.
  run(request: StepRun = {}): Effect.Effect<RunReport, RunFailed> {
    const { mode, now } = startOf(request);
    return Effect.suspend(() => {
      if (this.inFlight) return new RunFailed({ step: "run", reason: "a run is already in flight", status: CONFLICT });
      this.inFlight = true;
      return this.startRun(mode, now).pipe(
        // The one alert of a failed run, addressed to the step that failed. Nothing alerts inside the
        // steps, so a step that tried twice still costs one e-mail.
        Effect.tapError((error) =>
          Effect.sync(() => this.logger.error({ msg: "run failed", step: error.step, reason: error.reason })).pipe(
            Effect.andThen(this.alert.send(error.step, error.reason)),
          ),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            this.inFlight = false;
          }),
        ),
      );
    });
  }

  private startRun(mode: Mode, now: Date): Effect.Effect<RunReport, RunFailed> {
    return Effect.gen(this, function* () {
      const startedAt = Date.now();
      const date = runDate(now);
      this.logger.log({ msg: "run started", date, mode });

      const requestContext = new RequestContext<EditionContext>();
      requestContext.set("pipeline", this);

      const workflow = this.mastra.getWorkflow("edition");
      const started = yield* Effect.tryPromise({
        try: async () => {
          const run = await workflow.createRun();
          const result = await run.start({ inputData: { date, mode }, requestContext });
          return { runId: run.runId, result };
        },
        catch: (error) => new RunFailed({ step: "run", reason: String(error) }),
      });

      if (started.result.status !== "success") return yield* new RunFailed(runFailure(started.result));

      // What the workflow hands back is typed loosely by Mastra; the schema it was declared with
      // is what says it is a run, and a run that does not fit it is a failure with a name.
      const run = editionRunSchema.safeParse(started.result.result);
      if (!run.success)
        return yield* new RunFailed({ step: "run", reason: `workflow result is not a run: ${run.error.message}` });

      const report: RunReport = {
        ...run.data,
        runId: started.runId,
        durationMs: Date.now() - startedAt,
      };
      this.logger.log({ msg: "run finished", ...report });
      return report;
    });
  }
}
