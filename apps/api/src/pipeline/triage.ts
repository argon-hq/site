import type { LoggerService } from "@nestjs/common";
import { Data, Effect } from "effect";
import { dbEffect } from "../effect/db";
import type { PrismaClient } from "../generated/prisma/client";
import { twoAttempts } from "../mastra/attempts";
import { FOCUS, SCORE_MAX, triageAnswerSchema, type TriageAnswer, type Verdict } from "../mastra/schemas/triage";
import type { Ficha, Generate } from "./write";

// The model's triage of the day's fichas (ARG-124): one generation over the whole list, before any
// page is read, giving each ficha a focus class, an impact and a score, and naming the rewrites the
// title signature missed. The code keeps what it always kept — the cutoff, the pool, the order —
// and the model judges what the code cannot: whether the fact is the newsletter's and how much it
// matters. The classes come from `schemas/triage.ts`; the craft from the `select` skill.

export class TriageFailed extends Data.TaggedError("TriageFailed")<{ reason: string }> {}
export class TriageDbFailed extends Data.TaggedError("TriageDbFailed")<{ reason: string }> {}

// How much of the feed's text the model reads per ficha. A lead is enough to judge; the page is
// read later, for the ones that pass.
export const LEAD_CHARS = 320;

// How many fichas the writing works from once the model has spoken: twice the edition, so a ficha
// whose text cannot be had leaves its place to the next one.
export const SHORTLIST_POOL = 2;

export type Triaged = Ficha & { verdict: Verdict };

// What the newsletter already carried in the last days, for the same-story check.
export const publishedHeadlines = (prisma: PrismaClient, since: Date): Effect.Effect<string[], TriageDbFailed> =>
  dbEffect((reason) => new TriageDbFailed({ reason }))(() =>
    prisma.article.findMany({
      where: { editionId: { not: null }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { headline: true, originalTitle: true },
    }),
  ).pipe(Effect.map((rows) => rows.map((row) => row.headline ?? row.originalTitle)));

// Limits come from the code into the prompt; the skill holds the craft. Every ficha goes with its
// id, so the answer can be matched back without trusting the model to copy titles.
export function triagePrompt(fichas: readonly Ficha[], published: readonly string[]): string {
  const lines = fichas.map((ficha, index) => {
    const members = ficha.members.map((m) => `${m.sourceName}: ${m.title}`).join(" | ");
    return [
      `${index + 1}. id=${ficha.id}`,
      `   fonte: ${ficha.sourceName}`,
      `   título: ${ficha.originalTitle}`,
      `   lead: ${ficha.extractedText ? ficha.extractedText.slice(0, LEAD_CHARS) : "(nenhum)"}`,
      members ? `   também em: ${members}` : null,
      `   nota de código: ${ficha.codeScore}`,
    ]
      .filter((line) => line !== null)
      .join("\n");
  });
  return [
    'Carregue a skill "select" com a ferramenta skill e siga o processo dela.',
    `Classifique cada ficha em uma das classes: ${FOCUS.join(", ")}.`,
    `Impacto e nota de 0 a ${SCORE_MAX}, inteiros. Responda por todas as fichas, pelo id.`,
    "--- fichas ---",
    ...lines,
    "--- manchetes já publicadas nos últimos dias ---",
    published.length ? published.map((headline) => `- ${headline}`).join("\n") : "(nenhuma)",
    "--- fim ---",
  ].join("\n");
}

// Every ficha must come back, once, by its id; a verdict for a ficha that was not asked is
// ignored. A missing one is a reason for the second attempt.
export function matchVerdicts(fichas: readonly Ficha[], answer: TriageAnswer): Triaged[] | string {
  const byId = new Map(answer.fichas.map((verdict) => [verdict.id, verdict]));
  const missing = fichas.filter((ficha) => !byId.has(ficha.id)).map((ficha) => ficha.id);
  if (missing.length > 0) return `no verdict for ficha(s) ${missing.join(", ")}`;
  return fichas.map((ficha) => ({ ...ficha, verdict: byId.get(ficha.id) as Verdict }));
}

// Two attempts, like every generation: the second carries what the first got wrong.
export const triage = (
  fichas: readonly Ficha[],
  published: readonly string[],
  generate: Generate<TriageAnswer>,
  logger: LoggerService,
): Effect.Effect<{ triaged: Triaged[]; usage: unknown }, TriageFailed> =>
  twoAttempts(
    triagePrompt(fichas, published),
    (prompt) =>
      generate(prompt).pipe(
        Effect.mapError((error) => new TriageFailed({ reason: error.reason })),
        Effect.flatMap((generated) => {
          const matched = matchVerdicts(fichas, generated.object);
          return typeof matched === "string"
            ? Effect.fail(new TriageFailed({ reason: matched }))
            : Effect.succeed({ triaged: matched, usage: generated.usage });
        }),
      ),
    (reason) => {
      logger.warn({ msg: "triage rejected, retrying", reason });
    },
  );

export type Shortlist = {
  kept: Triaged[];
  out: Triaged[];
  sameAs: Triaged[];
  belowCutoff: Triaged[];
  overPool: Triaged[];
};

// What the code decides after the model spoke: out of focus and the same story go first, then the
// cutoff, then the order — the model's score, the code's score to break ties — and the pool.
export function shortlist(triaged: readonly Triaged[], p: { cutoff: number; max: number }): Shortlist {
  const out = triaged.filter((t) => t.verdict.focus === "out");
  const sameAs = triaged.filter((t) => t.verdict.focus !== "out" && t.verdict.sameAs !== undefined);
  const judged = triaged.filter((t) => t.verdict.focus !== "out" && t.verdict.sameAs === undefined);
  const belowCutoff = judged.filter((t) => t.verdict.score < p.cutoff);
  const passing = judged
    .filter((t) => t.verdict.score >= p.cutoff)
    .sort((a, b) => b.verdict.score - a.verdict.score || b.codeScore - a.codeScore);
  const pool = p.max * SHORTLIST_POOL;
  return { kept: passing.slice(0, pool), overPool: passing.slice(pool), out, sameAs, belowCutoff };
}

// The triage without a model: the code's prior, folded into the model's scale, every ficha in
// focus and none the same as another. A mocked run is for looking at the pipeline, not at the
// judgement, so the mock judges nothing — it only gives the next steps the shape they expect.
export const mockTriage = (fichas: readonly Ficha[]): Triaged[] =>
  fichas.map((ficha) => {
    const score = Math.min(SCORE_MAX, Math.max(0, ficha.codeScore - 3));
    return {
      ...ficha,
      verdict: {
        id: ficha.id,
        focus: "core_business",
        impact: score,
        score,
        reason: `mock: the code's score of ${ficha.codeScore}, folded into the model's scale`,
      },
    };
  });

export const triageSchema = triageAnswerSchema;
