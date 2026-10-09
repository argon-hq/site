import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { FOCUS, type TriageAnswer, type Verdict } from "../mastra/schemas/triage";
import { matchVerdicts, mockTriage, publishedHeadlines, shortlist, triage, triagePrompt, type Triaged } from "./triage";
import { ItemFailed, type Ficha, type Generate } from "./write";

const silent = { log: () => {}, warn: () => {}, error: () => {} };

const ficha = (id: string, over: Partial<Ficha> = {}): Ficha => ({
  id,
  canonicalUrl: `https://valor.globo.com/empresas/${id}`,
  sourceName: "Valor Econômico",
  originalTitle: `Notícia ${id}`,
  extractedText: null,
  textKind: "none",
  codeScore: 5,
  members: [],
  verdict: null,
  ...over,
});

const verdict = (id: string, over: Partial<Verdict> = {}): Verdict => ({
  id,
  focus: "core_business",
  impact: 4,
  score: 4,
  reason: "changes the cost of credit for small companies",
  ...over,
});

const answering = (
  ...answers: Array<TriageAnswer | string>
): { generate: Generate<TriageAnswer>; prompts: string[] } => {
  const prompts: string[] = [];
  const generate: Generate<TriageAnswer> = (prompt) => {
    prompts.push(prompt);
    const next = answers.shift();
    if (next === undefined) return Effect.fail(new ItemFailed({ reason: "no answer left" }));
    return typeof next === "string" ? Effect.fail(new ItemFailed({ reason: next })) : Effect.succeed({ object: next });
  };
  return { generate, prompts };
};

describe("triagePrompt", () => {
  it("names the skill, the classes, the scale, and every ficha by id with its lead and members", () => {
    const prompt = triagePrompt(
      [
        ficha("a1", {
          originalTitle: "Crédito para PMEs cresce",
          extractedText: "x".repeat(500),
          members: [
            { url: "https://folha.test/a", sourceName: "Folha", title: "PMEs têm mais crédito", textKind: "summary" },
          ],
        }),
        ficha("a2"),
      ],
      ["Copom mantém a Selic"],
    );
    expect(prompt).toContain('skill "select"');
    for (const focus of FOCUS) expect(prompt).toContain(focus);
    expect(prompt).toContain("0 a 5");
    expect(prompt).toContain("id=a1");
    expect(prompt).toContain("id=a2");
    expect(prompt).toContain("Folha: PMEs têm mais crédito");
    expect(prompt).toContain("(nenhum)");
    expect(prompt).toContain("- Copom mantém a Selic");
    expect(prompt).not.toContain("x".repeat(400)); // the lead is cut
  });
});

describe("matchVerdicts", () => {
  it("matches every ficha by id and ignores a verdict nobody asked for", () => {
    const matched = matchVerdicts([ficha("a1"), ficha("a2")], {
      fichas: [verdict("a2"), verdict("a1", { score: 2 }), verdict("ghost")],
    });
    expect(typeof matched !== "string" && matched.triaged.map((t) => [t.id, t.verdict.score])).toEqual([
      ["a1", 2],
      ["a2", 4],
    ]);
  });

  it("leaves out of focus a ficha the answer forgot, and names it", () => {
    const matched = matchVerdicts([ficha("a1"), ficha("a2"), ficha("a3")], { fichas: [verdict("a1"), verdict("a3")] });
    expect(typeof matched !== "string" && matched.missing).toEqual(["a2"]);
    expect(typeof matched !== "string" && matched.triaged[1]?.verdict).toMatchObject({ focus: "out", score: 0 });
  });

  it("refuses an answer that forgot more than half of the fichas", () => {
    expect(matchVerdicts([ficha("a1"), ficha("a2"), ficha("a3")], { fichas: [verdict("a1")] })).toBe(
      "no verdict for 2 of 3 fichas: a2, a3",
    );
  });
});

describe("triage", () => {
  it("gives the second attempt the reason the first was incomplete, and fails after two", async () => {
    const warn = vi.fn();
    const { generate, prompts } = answering({ fichas: [verdict("a1")] }, { fichas: [verdict("a1"), verdict("a2")] });
    const fichas = [ficha("a1"), ficha("a2"), ficha("a3")];
    const result = await Effect.runPromise(triage(fichas, [], generate, { ...silent, warn }));
    expect(result.triaged.map((t) => t.id)).toEqual(["a1", "a2", "a3"]);
    expect(prompts[1]).toContain("no verdict for 2 of 3 fichas");
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ msg: "triage rejected, retrying" }));
    expect(warn).toHaveBeenCalledWith({ msg: "fichas without a verdict, left out", ids: ["a3"] });

    const twice = answering("schema: focus invalid", "schema: focus invalid");
    const exit = await Effect.runPromiseExit(triage([ficha("a1")], [], twice.generate, silent));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("goes on with one ficha forgotten, without a second attempt", async () => {
    const { generate, prompts } = answering({ fichas: [verdict("a1"), verdict("a2")] });
    const result = await Effect.runPromise(triage([ficha("a1"), ficha("a2"), ficha("a3")], [], generate, silent));
    expect(prompts).toHaveLength(1);
    expect(result.triaged.find((t) => t.id === "a3")?.verdict.focus).toBe("out");
  });
});

describe("shortlist", () => {
  const triaged = (id: string, v: Partial<Verdict>, codeScore = 5): Triaged => ({
    ...ficha(id, { codeScore }),
    verdict: verdict(id, v),
  });

  it("drops what is out of focus and the same story, orders by the model then the code, and takes the edition plus the reserve", () => {
    const result = shortlist(
      [
        triaged("out", { focus: "out", score: 0, impact: 0 }),
        triaged("copy", { sameAs: "best", score: 0 }),
        triaged("low", { score: 1 }),
        triaged("best", { score: 5 }),
        triaged("tie-a", { score: 4 }, 6),
        triaged("tie-b", { score: 4 }, 8),
        triaged("fourth", { score: 3 }),
        triaged("fifth", { score: 3 }, 4),
        triaged("sixth", { score: 2 }),
      ],
      { max: 3 },
    );
    expect(result.chosen.map((t) => t.id)).toEqual(["best", "tie-b", "tie-a"]);
    expect(result.reserve.map((t) => t.id)).toEqual(["fourth", "fifth"]);
    expect(result.kept.map((t) => t.id)).toEqual(["best", "tie-b", "tie-a", "fourth", "fifth"]);
    expect(result.left.map((t) => t.id)).toEqual(["sixth", "low"]);
    expect(result.out.map((t) => t.id)).toEqual(["out"]);
    expect(result.sameAs.map((t) => t.id)).toEqual(["copy"]);
  });

  it("has no cutoff: a thin day's best still go, and a day with less than the edition goes whole", () => {
    const thin = shortlist([triaged("a", { score: 1 }), triaged("b", { score: 0 })], { max: 3 });
    expect(thin.chosen.map((t) => t.id)).toEqual(["a", "b"]);
    expect(thin.reserve).toEqual([]);
  });
});

describe("mockTriage", () => {
  it("folds the code's score into the model's scale and judges nothing", () => {
    const [low, mid, high] = mockTriage([
      ficha("l", { codeScore: 3 }),
      ficha("m", { codeScore: 6 }),
      ficha("h", { codeScore: 9 }),
    ]);
    expect([low?.verdict.score, mid?.verdict.score, high?.verdict.score]).toEqual([0, 3, 5]);
    expect(high?.verdict.focus).toBe("core_business");
    expect(high?.verdict.sameAs).toBeUndefined();
  });
});

describe("publishedHeadlines", () => {
  it("asks for the headlines of the editions since the date, the written one over the original", async () => {
    const findMany = vi.fn<(args: unknown) => Promise<{ headline: string | null; originalTitle: string }[]>>(
      async () => [
        { headline: "Manchete escrita", originalTitle: "Título original" },
        { headline: null, originalTitle: "Só o original" },
      ],
    );
    const prisma = { article: { findMany } } as unknown as PrismaClient;
    const since = new Date("2026-10-05T08:00:00Z");
    expect(await Effect.runPromise(publishedHeadlines(prisma, since))).toEqual(["Manchete escrita", "Só o original"]);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { editionId: { not: null }, createdAt: { gte: since } },
    });
  });
});
