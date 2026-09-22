import { Injectable, Logger } from "@nestjs/common";
import { MastraService } from "@mastra/nestjs";
import { RequestContext } from "@mastra/core/request-context";
import { Data, Effect } from "effect";
import { twoAttempts } from "../mastra/attempts";
import type { CollectContext } from "../mastra/tools/context";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { collectResultSchema, type CollectResult } from "./collect.schema";
import { OwnerAlert } from "./owner-alert";
import { persistCandidate, type Outcome } from "./persist";
import { MAX_SEARCHES, MAX_STEPS, MIN_SEARCHES, RECENT_DAYS, SOURCES, windowHours, windowStart } from "./rules";

export class CollectFailed extends Data.TaggedError("CollectFailed")<{ reason: string }> {}

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

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly mastra: MastraService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly alert: OwnerAlert,
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
