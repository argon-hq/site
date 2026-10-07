import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { liveDeps } from "../net/fetch";
import { editionDate } from "../pipeline/rules";
import { fixturePublished, fixtureSources } from "./fixtures";
import { ingestWorld } from "./mode";
import { titleSignature } from "./signature";
import type { Ficha } from "./store";

const NOW = new Date("2026-09-30T08:30:00Z");

function fakePrisma() {
  const mocks = {
    source: { findMany: vi.fn(async () => []), update: vi.fn() },
    article: {
      findMany: vi.fn<(args: unknown) => Promise<{ canonicalUrl: string; titleSignature: number[] }[]>>(async () => [
        { canonicalUrl: "https://x.test/today", titleSignature: titleSignature("Hoje") },
      ]),
      createMany: vi.fn(async ({ data }: { data: { sourceId: string | null }[] }) => ({ count: data.length })),
    },
  };
  return { prisma: mocks as unknown as PrismaClient, mocks };
}

const ficha: Ficha = {
  canonicalUrl: "https://www.diario-ficticio.test/empresas/a",
  sourceId: "fixture-diario",
  sourceName: "Diário Fictício",
  title: "Crédito cresce",
  publishedAt: NOW,
  origin: "feed",
  text: null,
  textKind: "none",
  codeScore: 4,
  signals: [],
  sources: 1,
  members: [],
  signature: titleSignature("Crédito cresce"),
};

describe("ingestWorld", () => {
  it("live reads the table over the network", async () => {
    const { prisma, mocks } = fakePrisma();
    const world = ingestWorld("live", prisma, NOW);
    expect(world.fetchDeps).toBe(liveDeps);
    await Effect.runPromise(world.store.activeSources());
    expect(mocks.source.findMany).toHaveBeenCalledOnce();
  });

  it("mock reads the fixture's sources through its own network, and records no health", async () => {
    const { prisma, mocks } = fakePrisma();
    const world = ingestWorld("mock", prisma, NOW);
    expect(world.fetchDeps).not.toBe(liveDeps);
    expect(await Effect.runPromise(world.store.activeSources())).toEqual(fixtureSources());
    expect(await Effect.runPromise(world.store.recordSource("fixture-diario", false, NOW))).toEqual({
      consecutiveFailures: 0,
      alert: false,
    });
    expect(mocks.source.findMany).not.toHaveBeenCalled();
    expect(mocks.source.update).not.toHaveBeenCalled();
  });

  it("mock knows the fixture's published list plus only today's rows", async () => {
    const { prisma, mocks } = fakePrisma();
    const { store } = ingestWorld("mock", prisma, NOW);
    const known = await Effect.runPromise(store.known(new Date("2026-09-27T08:30:00Z")));
    expect(known.map((k) => k.url)).toEqual([...fixturePublished().map((p) => p.url), "https://x.test/today"]);
    expect(mocks.article.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { createdAt: { gte: editionDate(NOW) } },
    });
  });

  it("mock stores fichas without a source row to point at", async () => {
    const { prisma, mocks } = fakePrisma();
    const { store } = ingestWorld("mock", prisma, NOW);
    expect(await Effect.runPromise(store.saveFichas([ficha]))).toBe(1);
    const call = mocks.article.createMany.mock.calls[0]?.[0] as { data: { sourceId: string | null }[] };
    expect(call.data[0]?.sourceId).toBeNull();
  });
});
