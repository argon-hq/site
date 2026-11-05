import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { ArgonMastra } from "../mastra/token";
import type { PrismaService } from "../prisma/prisma.service";
import { WRITE_DATASET, WriteDataset } from "./write-dataset";

const article = (n: number) => ({
  canonicalUrl: `https://valor.globo.com/${n}`,
  sourceName: "Valor",
  originalTitle: `Título ${n}`,
  extractedText: `Texto ${n}`,
});

function service(p: { articles: unknown[]; existing?: string[]; missing?: boolean }) {
  const dataset = {
    listItems: vi.fn(async () => ({ items: (p.existing ?? []).map((externalId) => ({ externalId })), pagination: {} })),
    addItems: vi.fn(async () => []),
  };
  const datasets = {
    get: vi.fn(async () => {
      if (p.missing) throw new Error("not found");
      return dataset;
    }),
    create: vi.fn(async () => dataset),
  };
  const findMany = vi.fn(async () => p.articles);
  const subject = new WriteDataset(
    { datasets } as unknown as ArgonMastra,
    { article: { findMany } } as unknown as PrismaService,
  );
  return { subject, dataset, datasets, findMany };
}

describe("the write dataset", () => {
  it("adds the day's articles with text as the writing step's prompt, once each", async () => {
    const { subject, dataset, findMany } = service({
      articles: [article(1), article(2)],
      existing: [article(2).canonicalUrl],
    });

    const added = await Effect.runPromise(subject.addDay("2026-11-04"));

    expect(added).toEqual({ dataset: WRITE_DATASET, date: "2026-11-04", added: 1, alreadyThere: 1 });
    // The São Paulo day, as instants.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdAt: { gte: new Date("2026-11-04T03:00:00Z"), lt: new Date("2026-11-05T03:00:00Z") },
          extractedText: { not: null },
        },
      }),
    );
    const items = (dataset.addItems.mock.calls[0] as unknown as [{ items: { externalId: string; input: string }[] }])[0]
      .items;
    expect(items).toHaveLength(1);
    expect(items[0]?.externalId).toBe(article(1).canonicalUrl);
    expect(items[0]?.input).toContain("--- notícia ---\nTexto 1\n--- fim ---");
    expect(items[0]?.input).toContain("Fonte: Valor");
  });

  it("creates the dataset the first time, aimed at the Editor and judged by fidelity", async () => {
    const { subject, datasets } = service({ articles: [article(1)], missing: true });

    await Effect.runPromise(subject.addDay("2026-11-04"));

    expect(datasets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: WRITE_DATASET,
        targetType: "agent",
        targetIds: ["editor"],
        scorerIds: ["hallucination-scorer"],
      }),
    );
  });

  it("answers 404 for a day with no article left to write from", async () => {
    const { subject } = service({ articles: [] });

    const exit = await Effect.runPromiseExit(subject.addDay("2026-11-01"));

    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail" && exit.cause.error).toMatchObject({ status: 404 });
  });
});
