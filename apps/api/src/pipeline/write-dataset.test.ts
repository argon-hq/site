import type { MastraService } from "@mastra/nestjs";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import { itemPrompt } from "./write";
import { WRITE_DATASET, WriteDataset } from "./write-dataset";

const article = (n: number, text: string | null = `Texto ${n}`) => ({
  id: `a${n}`,
  canonicalUrl: `https://valor.globo.com/${n}`,
  sourceName: "Valor",
  originalTitle: `Título ${n}`,
  extractedText: text,
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
  const mastra = { getMastra: () => ({ datasets }) } as unknown as MastraService;
  const prisma = { article: { findMany: vi.fn(async () => p.articles) } } as unknown as PrismaService;
  return { writeDataset: new WriteDataset(mastra, prisma), dataset, datasets };
}

describe("the write dataset", () => {
  it("adds each article of the day as the exact prompt the writing step uses, once", async () => {
    const { writeDataset, dataset } = service({
      articles: [article(1), article(2), article(3, null)],
      existing: ["https://valor.globo.com/2"],
    });

    const added = await Effect.runPromise(writeDataset.addEdition("2026-09-24"));

    expect(added).toEqual({ dataset: WRITE_DATASET, date: "2026-09-24", added: 1, alreadyThere: 1, withoutText: 1 });
    expect(dataset.addItems).toHaveBeenCalledWith({
      items: [
        expect.objectContaining({
          externalId: "https://valor.globo.com/1",
          input: itemPrompt(article(1) as never),
        }),
      ],
    });
  });

  it("creates the dataset the first time, aimed at the Editor", async () => {
    const { writeDataset, datasets } = service({ articles: [article(1)], missing: true });

    await Effect.runPromise(writeDataset.addEdition("2026-09-24"));

    expect(datasets.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: WRITE_DATASET, targetType: "agent", targetIds: ["editor"] }),
    );
  });

  it("answers 404 for a day with no articles", async () => {
    const { writeDataset } = service({ articles: [] });

    const exit = await Effect.runPromiseExit(writeDataset.addEdition("2026-09-20"));

    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail" && exit.cause.error).toMatchObject({ status: 404 });
  });
});
