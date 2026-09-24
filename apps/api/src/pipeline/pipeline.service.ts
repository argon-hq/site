import { Inject, Injectable, Logger } from "@nestjs/common";
import { MastraService } from "@mastra/nestjs";
import { RequestContext } from "@mastra/core/request-context";
import { Data, Effect } from "effect";
import type { z } from "zod";
import { editionHeaderSchema, writtenItemSchema, type EditionHeader } from "../mastra/schemas/edition";
import type { EditionContext } from "../mastra/workflows/context";
import type { EditionRun } from "../mastra/workflows/edition";
import { buildEdition, editionContext, toEditionInput, validateEdition } from "../email";
import { MailService } from "../mail/mail.service";
import type { BatchDelivery, Message } from "../mail/mail.types";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { ORIGINS, unsubscribePlaceholderUrl, type Origins } from "../subscriber/urls";
import { buildReason, loadEdition, saveBuilt } from "./build";
import { agentCollect, fixtureCollect } from "./collect-source";
import type { CollectResult } from "./collect.schema";
import { generateStructured } from "./generate";
import { OwnerAlert } from "./owner-alert";
import { personalize, sendRefusal, SUBSTITUTES_UNSUBSCRIBE_TOKEN } from "./personalize";
import { persistCandidate, type Outcome } from "./persist";
import { DEPLOYMENT, PROFILE, resolveMode, type Mode } from "./profile";
import { runDate, runFailure } from "./run";
import {
  assignBatches,
  batchKey,
  BATCH_SIZE,
  BatchRefused,
  closeEdition,
  countPending,
  countSettled,
  createDeliveries,
  deliverBatch,
  highestBatch,
  loadSendable,
  markSending,
  newRecipients,
  pendingBatches,
  recordBatch,
  SendDbFailed,
  type PendingBatch,
  type SendableEdition,
} from "./send";
import { editionDate, windowHours, windowStart } from "./rules";
import { mockHeader, mockItem } from "./write-mock";
import {
  belowMinimum,
  ItemFailed,
  openEdition,
  saveEdition,
  selectCandidates,
  skipEdition,
  sumUsage,
  writeHeader,
  writeItem,
  type Generate,
  type ItemResult,
  type WrittenResult,
} from "./write";

export class CollectFailed extends Data.TaggedError("CollectFailed")<{ reason: string }> {}
export class WriteFailed extends Data.TaggedError("WriteFailed")<{ reason: string }> {}
export class BuildFailed extends Data.TaggedError("BuildFailed")<{ reason: string }> {}
export class SendFailed extends Data.TaggedError("SendFailed")<{ reason: string }> {}
// A failed run says which step failed, so the single alert it sends is addressed.
export class RunFailed extends Data.TaggedError("RunFailed")<{ step: string; reason: string }> {}

export type CollectReport = {
  date: string;
  since: string;
  windowHours: number;
  cutoff: number;
  maxArticles: number;
  result: CollectResult;
  outcomes: Outcome[];
  saved: number;
  usage: unknown;
  durationMs: number;
};

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

// One batch as the report sees it. Which row failed and why is not here on purpose: an edition can
// carry thousands of rows, and the reason is already on the row, in `delivery.error`.
export type BatchOutcome = { batch: number; size: number; sent: number; failed: number };

export type SendReport = {
  date: string;
  editionId: string;
  // Where the edition ended up, which is how an operator reads "did it finish".
  status: "sent" | "sending";
  // Rows still owed when this run started, how many of those it created, and how many an earlier
  // run had already settled. Together they tell a resume apart from a first run at a glance.
  recipients: number;
  created: number;
  alreadySent: number;
  batches: BatchOutcome[];
  sent: number;
  failed: number;
  durationMs: number;
};

export type RunReport = EditionRun & { runId: string; durationMs: number };

// What a step is told before it starts: which clock to read and whether this run pays for judgement
// or works over the fixture. Both have a default, so a step can still be called bare in a test.
export type StepRun = { mode?: Mode; now?: Date };

const startOf = (p: StepRun) => ({ mode: resolveMode(DEPLOYMENT, p.mode), now: p.now ?? new Date() });

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  // One generation at a time. The process is single, so a flag is enough to keep the 5h30 run and a
  // run someone fired by hand from working on the same edition at once.
  private inFlight = false;

  // One send at a time, for the same reason: two overlapping sends would read the same pending rows
  // and build the same batches. The idempotency keys would still spare the subscribers, but the rows
  // would be written twice over.
  private sending = false;

  constructor(
    private readonly mastra: MastraService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly alert: OwnerAlert,
    private readonly mail: MailService,
    @Inject(ORIGINS) private readonly origins: Origins,
  ) {}

  // Collection step: the Editor loads the `collect` skill and works inside the rules set here. A
  // mocked run swaps where the news comes from and nothing else — what is stored is decided by the
  // same code either way.
  collect(run: StepRun = {}): Effect.Effect<CollectReport, CollectFailed> {
    const { mode, now } = startOf(run);
    return Effect.gen(this, function* () {
      const startedAt = Date.now();
      const settings = yield* Effect.tryPromise({
        try: () => this.settings.load(),
        catch: (error) => new CollectFailed({ reason: `settings: ${String(error)}` }),
      });
      const since = windowStart(now);
      this.logger.log({ msg: "collect started", mode, since: since.toISOString(), cutoff: settings.score_cutoff });

      const source =
        mode === "mock"
          ? fixtureCollect
          : agentCollect({ mastra: this.mastra, prisma: this.prisma, profile: PROFILE, logger: this.logger });

      const collected = yield* source({ now, since, cutoff: settings.score_cutoff, max: settings.max_articles }).pipe(
        Effect.mapError((error) => new CollectFailed({ reason: error.reason })),
      );

      // The list is persisted by code, one candidate at a time, in score order.
      const persistCtx = {
        prisma: this.prisma,
        since,
        cutoff: settings.score_cutoff,
        maxTextChars: PROFILE.maxTextChars,
        logger: this.logger,
      };
      const outcomes = yield* Effect.forEach(
        [...collected.result.candidates].sort((a, b) => b.score - a.score),
        (candidate) => persistCandidate(candidate, persistCtx, collected.read),
        { concurrency: 3 },
      ).pipe(Effect.mapError((e) => new CollectFailed({ reason: `database: ${e.reason}` })));

      const report: CollectReport = {
        date: now.toISOString(),
        since: since.toISOString(),
        windowHours: windowHours(now),
        cutoff: settings.score_cutoff,
        maxArticles: settings.max_articles,
        result: collected.result,
        outcomes,
        saved: outcomes.filter((o) => o.outcome === "saved").length,
        usage: collected.usage,
        durationMs: Date.now() - startedAt,
      };
      // `notes` is the agent's own account of what did not yield — the themes with no fresh news,
      // the sources that answered nothing. Without it in the log, a thin collection can only be
      // explained by paying for another one.
      this.logger.log({ msg: "collect finished", mode, saved: report.saved, evaluated: report.result.candidates.length, discarded: report.result.discarded, notes: report.result.notes, durationMs: report.durationMs, usage: report.usage });
      return report;
    }).pipe(
      // The alert is not here: with a retry per step, alerting inside the step would mail the owners
      // once per attempt. The run alerts once when the workflow gives up, and the per-step route
      // alerts for its own step.
      Effect.tapError((e) => Effect.sync(() => this.logger.error({ msg: "collect failed", reason: e.reason }))),
    );
  }

  // Writing step: the Editor loads the `write` skill and writes one article at a time, then the
  // edition header over what was approved. Selection happened in the collection step; this one
  // turns the stored text into what the e-mail carries.
  write(run: StepRun = {}): Effect.Effect<WriteReport, WriteFailed> {
    const { mode, now } = startOf(run);
    return Effect.gen(this, function* () {
      const startedAt = Date.now();
      const settings = yield* Effect.tryPromise({
        try: () => this.settings.load(),
        catch: (error) => new WriteFailed({ reason: `settings: ${String(error)}` }),
      });
      const date = editionDate(now);
      const day = date.toISOString().slice(0, 10);
      const since = windowStart(now);
      const failed = (error: { reason: string }) => new WriteFailed({ reason: error.reason });

      const edition = yield* openEdition(this.prisma, date).pipe(Effect.mapError(failed));
      const candidates = yield* selectCandidates(this.prisma, {
        editionId: edition.id,
        since,
        cutoff: settings.score_cutoff,
        max: settings.max_articles,
      }).pipe(Effect.mapError(failed));
      this.logger.log({ msg: "write started", mode, date: day, edition: edition.id, candidates: candidates.length });

      // One generation with a schema: the Mastra promise becomes an effect carrying its reason, so
      // the second attempt can quote what the first got wrong. Writing loads its skill through the
      // `skill` tool, so it works and takes shape in two calls, the same as the collection.
      const editor = this.mastra.getAgent("editor");
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
      const items = yield* Effect.forEach(
        candidates,
        (candidate) =>
          writeItem(candidate, mode === "mock" ? mockItem(candidate) : generating(writtenItemSchema), this.logger),
        { concurrency: 3 },
      );
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
      const short = `ficou com ${written.length} notícia(s) válida(s), abaixo do mínimo de ${settings.min_articles}`;
      const outcome = belowMinimum({ written: written.length, min: settings.min_articles, alreadyWritten: edition.alreadyWritten });

      if (outcome === "keep_previous") {
        return yield* new WriteFailed({
          reason: `edição ${day} já estava escrita e a rodada de agora ${short}; a edição anterior continua valendo`,
        });
      }
      if (outcome === "skip") {
        yield* skipEdition(this.prisma, edition.id).pipe(Effect.mapError(failed));
        this.logger.warn({ msg: "edition skipped", date: day, written: written.length, min: settings.min_articles });
        yield* this.alert.send("write", `edição ${day} ${short}`);
        return report("skipped", null, written.map((item) => item.usage));
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
        written: written.map(({ id, item }) => ({ id, item })),
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
    }).pipe(
      Effect.tapError((error) => Effect.sync(() => this.logger.error({ msg: "write failed", reason: error.reason }))),
    );
  }

  // Building step: no model, no judgement. The rows the writing step left become the HTML and the
  // plain text the sending step carries, and nothing is stored until the mechanical validation
  // passes. Same edition in, same e-mail out.
  build(run: StepRun = {}): Effect.Effect<BuildReport, BuildFailed> {
    const { now } = startOf(run);
    return Effect.gen(this, function* () {
      const startedAt = Date.now();
      const settings = yield* Effect.tryPromise({
        try: () => this.settings.load(),
        catch: (error) => new BuildFailed({ reason: `settings: ${String(error)}` }),
      });
      const date = editionDate(now);
      const day = date.toISOString().slice(0, 10);

      const written = yield* loadEdition(this.prisma, date).pipe(
        Effect.mapError((error) => new BuildFailed({ reason: error.reason })),
      );
      this.logger.log({ msg: "build started", date: day, edition: written.id, articles: written.articles.length });

      // One edition for everyone, so the stored HTML carries the unsubscribe placeholder; the
      // sending step swaps it for each subscriber's token.
      const context = editionContext(settings, {
        webOrigin: this.origins.web,
        unsubscribeUrl: unsubscribePlaceholderUrl(this.origins),
      });
      const built = yield* toEditionInput(written.edition, written.articles, context).pipe(
        Effect.flatMap((input) => buildEdition(input).pipe(Effect.flatMap((edition) => validateEdition(input, edition)))),
        Effect.mapError((error) => new BuildFailed({ reason: buildReason(error) })),
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
    }).pipe(
      Effect.tapError((error) => Effect.sync(() => this.logger.error({ msg: "build failed", reason: error.reason }))),
    );
  }
  // Sending step: no model and no judgement, like the building step. The edition the building step
  // left becomes one message per confirmed subscriber, handed to the provider in batches. It is a
  // run of its own, at 7h, and not a fourth step of the generation workflow: the edition is ready
  // long before it, and a resend has nothing to do with generating anything.
  send(run: StepRun = {}): Effect.Effect<SendReport, SendFailed> {
    const { now } = startOf(run);
    return Effect.suspend(() => {
      if (this.sending) return new SendFailed({ reason: "a send is already in flight" });
      this.sending = true;
      return this.startSend(now).pipe(
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

  private startSend(now: Date): Effect.Effect<SendReport, SendFailed> {
    return Effect.gen(this, function* () {
      // Before any read and any write: production does not mail an edition whose unsubscribe link is
      // still a placeholder, whoever asks.
      const refusal = sendRefusal(DEPLOYMENT, SUBSTITUTES_UNSUBSCRIBE_TOKEN);
      if (refusal !== null) return yield* new SendFailed({ reason: refusal });

      const startedAt = Date.now();
      const settings = yield* Effect.tryPromise({
        try: () => this.settings.load(),
        catch: (error) => new SendFailed({ reason: `settings: ${String(error)}` }),
      });
      const date = editionDate(now);
      const day = date.toISOString().slice(0, 10);
      const failed = (error: { reason: string }) => new SendFailed({ reason: error.reason });

      // The kill switch, read from the database immediately before anything leaves. A paused send
      // writes nothing at all, so it is a failure of the step and not an outcome of it — which is
      // what puts it on the one alert path without an alert inside the step.
      if (settings.sending_paused) {
        return yield* new SendFailed({ reason: `envio pausado: a edição ${day} não saiu porque sending_paused está ligado` });
      }

      const edition = yield* loadSendable(this.prisma, date).pipe(Effect.mapError(failed));
      // On its way out before the first row exists: a run that dies here leaves an edition the next
      // send resumes, instead of one the building step would quietly rebuild over.
      yield* markSending(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));

      // Whoever confirmed since the last run starts a batch after the highest one already handed
      // out. Adding them to a batch that already went out would change what that key stands for.
      const from = yield* highestBatch(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));
      const recipients = yield* newRecipients(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));
      yield* createDeliveries(this.prisma, {
        editionId: edition.id,
        rows: assignBatches(recipients, from),
      }).pipe(Effect.mapError(failed));

      const settled = yield* countSettled(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));
      const batches = yield* pendingBatches(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));
      const waiting = batches.reduce((total, batch) => total + batch.rows.length, 0);
      this.logger.log({
        msg: "send started",
        date: day,
        edition: edition.id,
        recipients: waiting,
        created: recipients.length,
        alreadySent: settled,
        batches: batches.length,
        batchSize: BATCH_SIZE,
      });

      // One batch at a time, which is `Effect.forEach`'s default and has to stay that way. Each
      // batch is a hundred-message call against a provider with a request-rate limit, so going wide
      // buys throughput a newsletter does not need and makes a 429 likely; sequential is also what
      // leaves a clean prefix of settled batches when a run dies, which is what the resume reads.
      const outcomes = yield* Effect.forEach(batches, (batch) => this.sendOneBatch(edition, batch, now)).pipe(
        Effect.mapError(failed),
      );

      const pending = yield* countPending(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));
      if (pending === 0) yield* closeEdition(this.prisma, { editionId: edition.id, now }).pipe(Effect.mapError(failed));

      const report: SendReport = {
        date: day,
        editionId: edition.id,
        status: pending === 0 ? "sent" : "sending",
        recipients: waiting,
        created: recipients.length,
        alreadySent: settled,
        batches: outcomes,
        sent: outcomes.reduce((total, batch) => total + batch.sent, 0),
        failed: outcomes.reduce((total, batch) => total + batch.failed, 0),
        durationMs: Date.now() - startedAt,
      };
      // An edition with nobody to send it to is not a failure: lab and a development machine hit it
      // constantly. It closes as sent, and the warning is what says the list was empty.
      if (waiting === 0) this.logger.warn({ msg: "edition sent to nobody", date: day, edition: edition.id });
      this.logger.log({ msg: "send finished", ...report });
      return report;
    });
  }

  // One batch: the stored edition becomes one message per row, the provider answers one result per
  // message, and the whole answer is written in a single transaction — a batch settles or it does
  // not. A row that cannot be personalised never enters the payload; only ARG-114 can produce one.
  private sendOneBatch(
    edition: SendableEdition,
    batch: PendingBatch,
    now: Date,
  ): Effect.Effect<BatchOutcome, SendDbFailed | BatchRefused> {
    return Effect.gen(this, function* () {
      const results: { id: string; result: BatchDelivery }[] = [];
      const messages: Message[] = [];
      // The delivery row each message belongs to, in the same order: the provider answers by
      // position and nothing else links an id back to a subscriber.
      const addressed: string[] = [];

      for (const row of batch.rows) {
        const copy = personalize(edition);
        if (copy.outcome === "unpersonalizable") {
          results.push({ id: row.id, result: { outcome: "refused", reason: copy.reason } });
          continue;
        }
        addressed.push(row.id);
        messages.push({
          to: row.recipient.email,
          subject: edition.subject,
          html: copy.html,
          text: copy.text,
          headers: copy.headers,
        });
      }

      const answers =
        messages.length === 0
          ? []
          : yield* deliverBatch(this.mail, { messages, idempotencyKey: batchKey(edition.id, batch.batch) });

      // The transport owes one result per message. If it ever does not, stop: writing the answers
      // out of step would put one subscriber's provider id on another subscriber's row.
      if (answers.length !== messages.length) {
        return yield* new BatchRefused({
          reason: `batch ${batch.batch} of edition ${edition.id} got ${answers.length} answer(s) for ${messages.length} message(s)`,
        });
      }
      answers.forEach((result, index) => results.push({ id: addressed[index], result }));

      yield* recordBatch(this.prisma, { rows: results, now });

      const refused = results.filter((row) => row.result.outcome === "refused");
      for (const row of refused) {
        if (row.result.outcome === "refused") {
          this.logger.warn({ msg: "delivery failed", edition: edition.id, delivery: row.id, reason: row.result.reason });
        }
      }
      return { batch: batch.batch, size: results.length, sent: results.length - refused.length, failed: refused.length };
    });
  }

  // The whole generation as one run of the `edition` workflow: collect → write → build, each step
  // with its own retry and its own state in the Studio. The steps have no Nest injection, so the run
  // hands them this service through the request context — the same deal the tools have.
  run(request: StepRun = {}): Effect.Effect<RunReport, RunFailed> {
    const { mode, now } = startOf(request);
    return Effect.suspend(() => {
      if (this.inFlight) return new RunFailed({ step: "run", reason: "a run is already in flight" });
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

      const report: RunReport = {
        ...(started.result.result as EditionRun),
        runId: started.runId,
        durationMs: Date.now() - startedAt,
      };
      this.logger.log({ msg: "run finished", ...report });
      return report;
    });
  }
}
