import type { LoggerService } from "@nestjs/common";
import type { MastraService } from "@mastra/nestjs";
import { RequestContext } from "@mastra/core/request-context";
import { Data, Effect } from "effect";
import { twoAttempts } from "../mastra/attempts";
import { PageUnreadable, fetchArticle } from "../mastra/tools/read-page";
import type { CollectContext } from "../mastra/tools/context";
import type { PrismaClient } from "../generated/prisma/client";
import { collectResultSchema, type CollectResult } from "./collect.schema";
import { fixtureNews } from "./fixtures/news";
import type { ReadPage } from "./persist";
import type { Profile } from "./profile";
import { canonicalize, RECENT_DAYS, SOURCES } from "./rules";

export class CollectSourceFailed extends Data.TaggedError("CollectSourceFailed")<{ reason: string }> {}

// What one collection run looks for. The window and the cutoff come from the rules and the settings;
// the source only answers within them.
export type CollectRun = { now: Date; since: Date; cutoff: number; max: number };

// What a source answers: the candidates, what the run cost, and how to read each page. The reading
// travels with the answer because it is part of where the news came from — the live source reads the
// web, the fixture reads itself — and `persistCandidate` takes it as a parameter already.
export type Collected = { result: CollectResult; usage: unknown; read: ReadPage };

export type CollectSource = (run: CollectRun) => Effect.Effect<Collected, CollectSourceFailed>;

// The Editor searches the sources and scores what it read. This is the step as production runs it.
export const agentCollect = (deps: {
  mastra: MastraService;
  prisma: PrismaClient;
  profile: Profile;
  logger: LoggerService;
}): CollectSource => {
  const { mastra, prisma, profile, logger } = deps;

  return (run) =>
    Effect.gen(function* () {
      // Tools have no Nest injection: they read what the run needs from the request context.
      const requestContext = new RequestContext<CollectContext>();
      requestContext.set("prisma", prisma);
      requestContext.set("recentDays", RECENT_DAYS);

      const editor = mastra.getAgent("editor");
      const generated = yield* twoAttempts(
        collectPrompt({ ...run, profile }),
        (text) =>
          Effect.tryPromise({
            try: () =>
              editor.generate(text, {
                structuredOutput: { schema: collectResultSchema },
                requestContext,
                maxSteps: profile.maxSteps,
              }),
            catch: (error) => new CollectSourceFailed({ reason: String(error) }),
          }),
        (reason) => logger.warn({ msg: "first attempt rejected, retrying", reason }),
      );

      const toolCalls = (generated.toolCalls ?? []).map((call) => call.payload?.toolName ?? "?");
      logger.log({
        msg: "editor finished",
        steps: generated.steps?.length ?? null,
        toolCalls: countBy(toolCalls),
        evaluated: generated.object.candidates.length,
      });

      return { result: generated.object, usage: generated.usage ?? null, read: fetchArticle };
    });
};

// The same step over invented news: no search, no model, no page fetched. Everything after it is the
// real thing — allowlist, window, cutoff and duplicates are applied by `persistCandidate` exactly as
// they are for the agent's answers, so what a mocked run proves is the pipeline, not a shortcut.
export const fixtureCollect: CollectSource = (run) =>
  Effect.sync(() => {
    const news = fixtureNews(run.now);
    const pages = new Map(news.map((item) => [canonicalize(item.page.canonicalUrl), item.page]));

    const read: ReadPage = (url) => {
      const page = pages.get(canonicalize(url));
      return page ? Effect.succeed(page) : new PageUnreadable({ url, reason: "not in the fixture" });
    };

    return {
      result: {
        candidates: news.map((item) => item.candidate),
        discarded: 0,
        notes: "Rodada mockada: notícias do fixture, nenhuma busca e nenhum modelo.",
      },
      usage: null,
      read,
    };
  });

// The sources come from the rules, not from the skill: one list for the search allowlist, the
// persistence and the prompt.
export function collectPrompt(p: CollectRun & { profile: Profile }): string {
  const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Sao_Paulo" });
  return [
    `Hoje é ${fmt.format(p.now)} (horário de Brasília).`,
    'Carregue a skill "collect" com a ferramenta skill e siga o processo dela.',
    `Janela: só notícias publicadas depois de ${fmt.format(p.since)}.`,
    `Corte: nota ${p.cutoff}. Pare ao ter ${p.max} notícias acima do corte ou ao esgotar as fontes.`,
    `Buscas: de ${p.profile.minSearches} a ${p.profile.maxSearches}, sem repetir a mesma consulta.`,
    "Fontes disponíveis na busca, e as únicas que o sistema guarda:",
    ...SOURCES.map((source) => `- ${source.name} (${source.domain}): ${source.covers}`),
    "No fim, responda no formato pedido com todas as notícias lidas, inclusive as abaixo do corte.",
  ].join("\n");
}

function countBy(names: string[]): Record<string, number> {
  return names.reduce<Record<string, number>>((acc, n) => ({ ...acc, [n]: (acc[n] ?? 0) + 1 }), {});
}
