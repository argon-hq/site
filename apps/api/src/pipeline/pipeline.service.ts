import { Inject, Injectable, Logger } from "@nestjs/common";
import { MastraService } from "@mastra/nestjs";
import { RequestContext } from "@mastra/core/request-context";
import { Data, Effect } from "effect";
import type { z } from "zod";
import { twoAttempts } from "../mastra/attempts";
import { editionHeaderSchema, writtenItemSchema, type EditionHeader } from "../mastra/schemas/edition";
import type { CollectContext } from "../mastra/tools/context";
import { buildEdition, editionContext, toEditionInput, validateEdition } from "../email";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { ORIGINS, unsubscribePlaceholderUrl, type Origins } from "../subscriber/urls";
import { buildReason, loadEdition, saveBuilt } from "./build";
import { collectResultSchema, type CollectResult } from "./collect.schema";
import { OwnerAlert } from "./owner-alert";
import { persistCandidate, type Outcome } from "./persist";
import { editionDate, MAX_SEARCHES, MAX_STEPS, MIN_SEARCHES, RECENT_DAYS, SOURCES, windowHours, windowStart } from "./rules";
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

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly mastra: MastraService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly alert: OwnerAlert,
    @Inject(ORIGINS) private readonly origins: Origins,
  ) {}

  // Collection step: the Editor loads the `collect` skill and works inside the rules set here.
  collect(now = new Date()): Effect.Effect<CollectReport, CollectFailed> {
    return Effect.gen(this, function* () {
      const startedAt = Date.now();
      const settings = yield* Effect.tryPromise({
        try: () => this.settings.load(),
        catch: (error) => new CollectFailed({ reason: `settings: ${String(error)}` }),
      });
      const since = windowStart(now);
      const prompt = collectPrompt({ now, since, cutoff: settings.score_cutoff, max: settings.max_articles });
      this.logger.log({ msg: "collect started", since: since.toISOString(), cutoff: settings.score_cutoff });

      // Tools have no Nest injection: they read what the run needs from the request context.
      const requestContext = new RequestContext<CollectContext>();
      requestContext.set("prisma", this.prisma);
      requestContext.set("recentDays", RECENT_DAYS);

      const editor = this.mastra.getAgent("editor");
      const generated = yield* twoAttempts(
        prompt,
        (text) =>
          Effect.tryPromise({
            try: () =>
              editor.generate(text, {
                structuredOutput: { schema: collectResultSchema },
                requestContext,
                maxSteps: MAX_STEPS,
              }),
            catch: (error) => new CollectFailed({ reason: String(error) }),
          }),
        (reason) => this.logger.warn({ msg: "first attempt rejected, retrying", reason }),
      );

      const toolCalls = (generated.toolCalls ?? []).map((call) => call.payload?.toolName ?? "?");
      this.logger.log({ msg: "editor finished", steps: generated.steps?.length ?? null, toolCalls: countBy(toolCalls), evaluated: generated.object.candidates.length });

      // The agent's list is persisted by code, one candidate at a time, in score order.
      const persistCtx = { prisma: this.prisma, since, cutoff: settings.score_cutoff, logger: this.logger };
      const outcomes = yield* Effect.forEach(
        [...generated.object.candidates].sort((a, b) => b.score - a.score),
        (candidate) => persistCandidate(candidate, persistCtx),
        { concurrency: 3 },
      ).pipe(Effect.mapError((e) => new CollectFailed({ reason: `database: ${e.reason}` })));

      const report: CollectReport = {
        date: now.toISOString(),
        since: since.toISOString(),
        windowHours: windowHours(now),
        cutoff: settings.score_cutoff,
        maxArticles: settings.max_articles,
        result: generated.object,
        outcomes,
        saved: outcomes.filter((o) => o.outcome === "saved").length,
        usage: generated.usage ?? null,
        durationMs: Date.now() - startedAt,
      };
      this.logger.log({ msg: "collect finished", saved: report.saved, evaluated: report.result.candidates.length, discarded: report.result.discarded, durationMs: report.durationMs, usage: report.usage });
      return report;
    }).pipe(
      // A failed step is logged and mailed to the owners, as the architecture requires.
      Effect.tapError((e) =>
        Effect.sync(() => this.logger.error({ msg: "collect failed", reason: e.reason })).pipe(
          Effect.andThen(this.alert.send("collect", e.reason)),
        ),
      ),
    );
  }

  // Writing step: the Editor loads the `write` skill and writes one article at a time, then the
  // edition header over what was approved. Selection happened in the collection step; this one
  // turns the stored text into what the e-mail carries.
  write(now = new Date()): Effect.Effect<WriteReport, WriteFailed> {
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
      this.logger.log({ msg: "write started", date: day, edition: edition.id, candidates: candidates.length });

      // One generation with a schema: the Mastra promise becomes an effect carrying its reason, so
      // the second attempt can quote what the first got wrong.
      const editor = this.mastra.getAgent("editor");
      const generating =
        <S extends z.ZodType>(schema: S): Generate<z.infer<S>> =>
        (text) =>
          Effect.tryPromise({
            try: async () => {
              const generated = await editor.generate(text, { structuredOutput: { schema } });
              return { object: generated.object as z.infer<S>, usage: generated.usage };
            },
            catch: (error) => new ItemFailed({ reason: String(error) }),
          });

      const items = yield* Effect.forEach(candidates, (candidate) => writeItem(candidate, generating(writtenItemSchema), this.logger), {
        concurrency: 3,
      });
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

      const header = yield* writeHeader(
        written.map((item) => item.item),
        generating(editionHeaderSchema),
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
        date: day,
        subject: done.header?.subject,
        written: done.written,
        rejected: done.rejected,
        durationMs: done.durationMs,
        usage: done.usage,
      });
      return done;
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => this.logger.error({ msg: "write failed", reason: error.reason })).pipe(
          Effect.andThen(this.alert.send("write", error.reason)),
        ),
      ),
    );
  }

  // Building step: no model, no judgement. The rows the writing step left become the HTML and the
  // plain text the sending step carries, and nothing is stored until the mechanical validation
  // passes. Same edition in, same e-mail out.
  build(now = new Date()): Effect.Effect<BuildReport, BuildFailed> {
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
      const context = editionContext(settings, unsubscribePlaceholderUrl(this.origins));
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
      Effect.tapError((error) =>
        Effect.sync(() => this.logger.error({ msg: "build failed", reason: error.reason })).pipe(
          Effect.andThen(this.alert.send("build", error.reason)),
        ),
      ),
    );
  }
}

// The sources come from the rules, not from the skill: one list for the search allowlist, the
// persistence and the prompt.
function collectPrompt(p: { now: Date; since: Date; cutoff: number; max: number }): string {
  const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Sao_Paulo" });
  return [
    `Hoje é ${fmt.format(p.now)} (horário de Brasília).`,
    "Carregue a skill \"collect\" com a ferramenta skill e siga o processo dela.",
    `Janela: só notícias publicadas depois de ${fmt.format(p.since)}.`,
    `Corte: nota ${p.cutoff}. Pare ao ter ${p.max} notícias acima do corte ou ao esgotar as fontes.`,
    `Buscas: de ${MIN_SEARCHES} a ${MAX_SEARCHES}, sem repetir a mesma consulta.`,
    "Fontes disponíveis na busca, e as únicas que o sistema guarda:",
    ...SOURCES.map((source) => `- ${source.name} (${source.domain}): ${source.covers}`),
    "No fim, responda no formato pedido com todas as notícias lidas, inclusive as abaixo do corte.",
  ].join("\n");
}

function countBy(names: string[]): Record<string, number> {
  return names.reduce<Record<string, number>>((acc, n) => ({ ...acc, [n]: (acc[n] ?? 0) + 1 }), {});
}
