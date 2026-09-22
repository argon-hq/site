import type { LoggerService } from "@nestjs/common";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { BODY_MAX, SUBJECT_MAX, type WrittenItem } from "../mastra/schemas/edition";
import {
  headerPrompt,
  itemPrompt,
  ItemFailed,
  openEdition,
  saveEdition,
  selectCandidates,
  sumUsage,
  writeItem,
  type Candidate,
  type Generate,
} from "./write";

const silent: LoggerService = { log: () => {}, warn: () => {}, error: () => {} };

const candidate: Candidate = {
  id: "a1",
  canonicalUrl: "https://valor.globo.com/empresas/noticia/x.ghtml",
  sourceName: "Valor Econômico",
  originalTitle: "Copom mantém a Selic em 12%",
  extractedText: "O Copom manteve a taxa básica de juros em 12% ao ano.",
};

const item: WrittenItem = { category: "economy", headline: "Copom mantém a Selic em 12%", body: "O Copom manteve a taxa em 12%." };

// Answers the given results in order, one per attempt, and records the prompts it received. A
// string stands for a rejected generation, the way Mastra reports a schema the model did not meet.
function generator(...results: Array<WrittenItem | string>): { generate: Generate<WrittenItem>; prompts: string[] } {
  const prompts: string[] = [];
  const generate: Generate<WrittenItem> = (prompt) => {
    prompts.push(prompt);
    const result = results[prompts.length - 1];
    return typeof result === "string" || result === undefined
      ? Effect.fail(new ItemFailed({ reason: String(result) }))
      : Effect.succeed({ object: result, usage: { inputTokens: 10, outputTokens: 5 } });
  };
  return { generate, prompts };
}

describe("writeItem", () => {
  it("writes the item and keeps the article id for the persistence", async () => {
    const result = await Effect.runPromise(writeItem(candidate, generator(item).generate, silent));
    expect(result).toMatchObject({ outcome: "written", id: "a1", url: candidate.canonicalUrl, item });
  });

  it("gives the second attempt the reason the first was rejected", async () => {
    const { generate, prompts } = generator("body: 214 caracteres, máximo 190", item);
    const result = await Effect.runPromise(writeItem(candidate, generate, silent));

    expect(result.outcome).toBe("written");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("214 caracteres");
  });

  it("drops the article after two attempts instead of failing the step", async () => {
    const { generate, prompts } = generator("corpo estourado", "corpo estourado de novo");
    const result = await Effect.runPromise(writeItem(candidate, generate, silent));

    expect(prompts).toHaveLength(2);
    expect(result).toEqual({ outcome: "rejected", url: candidate.canonicalUrl, reason: "corpo estourado de novo" });
  });
});

describe("prompts", () => {
  it("carries the limits from the code and names the skill", () => {
    const prompt = itemPrompt(candidate);
    expect(prompt).toContain('skill "write"');
    expect(prompt).toContain(String(BODY_MAX));
    expect(prompt).toContain("economy");
    expect(prompt).toContain(candidate.extractedText);
  });

  it("gives the header the written items in edition order", () => {
    const prompt = headerPrompt([item, { ...item, headline: "Segunda manchete" }]);
    expect(prompt).toContain(String(SUBJECT_MAX));
    expect(prompt.indexOf("Copom")).toBeLessThan(prompt.indexOf("Segunda manchete"));
  });
});

describe("openEdition", () => {
  const edition = (status: string) =>
    ({ edition: { upsert: vi.fn(async () => ({ id: "e1", status })) } }) as unknown as PrismaClient;

  it("reuses the row of the day", async () => {
    const result = await Effect.runPromise(openEdition(edition("generating"), new Date("2026-09-22T00:00:00Z")));
    expect(result).toEqual({ id: "e1", status: "generating" });
  });

  it("refuses to rewrite an edition already on its way out", async () => {
    const exit = await Effect.runPromiseExit(openEdition(edition("sent"), new Date("2026-09-22T00:00:00Z")));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("selectCandidates", () => {
  it("asks for what is inside the window, above the cutoff and free or already in this edition", async () => {
    const queries: Array<{ where: unknown; take: number }> = [];
    const findMany = vi.fn(async (args: { where: unknown; take: number }) => {
      queries.push(args);
      return [
        { ...candidate },
        { id: "a2", canonicalUrl: "https://exame.com/y", sourceName: "Exame", originalTitle: "t", extractedText: null },
      ];
    });
    const prisma = { article: { findMany } } as unknown as PrismaClient;
    const since = new Date("2026-09-21T08:00:00Z");

    const result = await Effect.runPromise(selectCandidates(prisma, { editionId: "e1", since, cutoff: 3, max: 6 }));

    // The article whose text was already cleared by the retention is not writable.
    expect(result).toEqual([candidate]);
    expect(queries[0]).toMatchObject({
      where: { OR: [{ editionId: null }, { editionId: "e1" }], createdAt: { gte: since }, score: { gte: 3 } },
      take: 6,
    });
  });
});

describe("saveEdition", () => {
  it("detaches what an earlier run left and attaches what was written now", async () => {
    const calls: unknown[] = [];
    const record = (op: string) => vi.fn((args: unknown) => ({ op, args }));
    const prisma = {
      article: { updateMany: record("article.updateMany"), update: record("article.update") },
      edition: { update: record("edition.update") },
      $transaction: vi.fn(async (ops: unknown[]) => calls.push(...ops)),
    } as unknown as PrismaClient;

    await Effect.runPromise(
      saveEdition(prisma, { editionId: "e1", header: { title: "Manhã", subject: "Selic parada" }, written: [{ id: "a1", item }] }),
    );

    expect(calls).toEqual([
      { op: "article.updateMany", args: { where: { editionId: "e1" }, data: { editionId: null, category: null, headline: null, body: null } } },
      {
        op: "article.update",
        args: { where: { id: "a1" }, data: { editionId: "e1", category: "economy", headline: item.headline, body: item.body } },
      },
      { op: "edition.update", args: { where: { id: "e1" }, data: { title: "Manhã", subject: "Selic parada", status: "generating" } } },
    ]);
  });
});

describe("sumUsage", () => {
  it("adds every call of the step and ignores what is not a number", () => {
    expect(sumUsage([{ inputTokens: 10, outputTokens: 4, model: "x" }, { inputTokens: 5 }, null])).toEqual({
      inputTokens: 15,
      outputTokens: 4,
    });
  });
});
