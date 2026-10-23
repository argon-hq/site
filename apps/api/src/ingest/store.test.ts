import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { titleSignature } from "./signature";
import { FAILURES_BEFORE_ALERT, MAX_FEED_TEXT_CHARS, prismaIngestStore, type Ficha } from "./store";

const AT = new Date("2026-09-30T08:30:00Z");

// A fake Prisma: every call answers what the test says and remembers how it was asked.
function fakePrisma(over: { failures?: number; claimed?: number } = {}) {
  const mocks = {
    source: {
      findMany: vi.fn(async () => [
        {
          id: "s1",
          domain: "valor.globo.com",
          name: "Valor",
          trust: 1,
          sectionRules: [{ match: "path", pattern: "/empresas/", tier: "core" }],
          feeds: [{ id: "f1", kind: "feed", url: "https://valor.globo.com/rss" }],
        },
        { id: "s2", domain: "exame.com", name: "Exame", trust: 0, sectionRules: "not rules", feeds: [] },
      ]),
      update: vi.fn(async () => ({ consecutiveFailures: over.failures ?? 1 })),
      updateMany: vi.fn(async () => ({ count: over.claimed ?? 1 })),
    },
    seenUrl: {
      findMany: vi.fn(async ({ where }: { where: { urlHash: { in: string[] } } }) =>
        where.urlHash.in.filter((h) => h.startsWith("seen")).map((urlHash) => ({ urlHash })),
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    article: {
      findMany: vi.fn<(args: unknown) => Promise<{ canonicalUrl: string; titleSignature: number[] }[]>>(async () => [
        { canonicalUrl: "https://x.test/a", titleSignature: titleSignature("Copom") },
      ]),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    },
    $transaction: vi.fn(async (calls: Promise<unknown>[]) => Promise.all(calls)),
  };
  return { prisma: mocks as unknown as PrismaClient, mocks };
}

const ficha = (text: string | null = null): Ficha => ({
  canonicalUrl: "https://valor.globo.com/empresas/a",
  sourceId: "s1",
  sourceName: "Valor",
  title: "Copom mantém a Selic",
  publishedAt: AT,
  origin: "feed",
  text,
  textKind: text ? "summary" : "none",
  codeScore: 5,
  signals: [{ signal: "lexicon_core", points: 3 }],
  sources: 1,
  members: [],
  signature: titleSignature("Copom mantém a Selic"),
});

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("prismaIngestStore", () => {
  it("reads the active sources with their rules, and a rules column that does not parse as no rules", async () => {
    const { prisma } = fakePrisma();
    const sources = await run(prismaIngestStore(prisma).activeSources());
    expect(sources.map((s) => s.sectionRules.length)).toEqual([1, 0]);
    expect(sources[0]?.feeds[0]?.url).toBe("https://valor.globo.com/rss");
  });

  it("answers which hashes were seen, without a query for none", async () => {
    const { prisma, mocks } = fakePrisma();
    const store = prismaIngestStore(prisma);
    expect(await run(store.seen([]))).toEqual(new Set());
    expect(mocks.seenUrl.findMany).not.toHaveBeenCalled();
    expect(await run(store.seen(["seen-1", "new-2"]))).toEqual(new Set(["seen-1"]));
  });

  it("marks seen by refreshing what is there and inserting the rest, in one transaction", async () => {
    const { prisma, mocks } = fakePrisma();
    await run(prismaIngestStore(prisma).markSeen(["h1", "h2"], AT));
    expect(mocks.$transaction).toHaveBeenCalledOnce();
    expect(mocks.seenUrl.updateMany).toHaveBeenCalledWith({
      where: { urlHash: { in: ["h1", "h2"] } },
      data: { seenAt: AT },
    });
    expect(mocks.seenUrl.createMany).toHaveBeenCalledWith({
      data: [
        { urlHash: "h1", seenAt: AT },
        { urlHash: "h2", seenAt: AT },
      ],
      skipDuplicates: true,
    });
    await run(prismaIngestStore(prisma).markSeen([], AT));
    expect(mocks.$transaction).toHaveBeenCalledOnce();
  });

  it("knows the articles with a signature since a date", async () => {
    const { prisma, mocks } = fakePrisma();
    const known = await run(prismaIngestStore(prisma).known(AT));
    expect(known).toEqual([{ url: "https://x.test/a", signature: titleSignature("Copom") }]);
    expect(mocks.article.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { createdAt: { gte: AT } } });
  });

  it("saves fichas as articles without an edition, the feed text cut, duplicates skipped", async () => {
    const { prisma, mocks } = fakePrisma();
    const long = "x".repeat(MAX_FEED_TEXT_CHARS + 10);
    expect(await run(prismaIngestStore(prisma).saveFichas([ficha(long), ficha()]))).toBe(2);
    const call = mocks.article.createMany.mock.calls[0]?.[0] as {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    };
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[0]).toMatchObject({
      canonicalUrl: "https://valor.globo.com/empresas/a",
      originalTitle: "Copom mantém a Selic",
      codeScore: 5,
      textKind: "summary",
      scoreDetails: { signals: [{ signal: "lexicon_core", points: 3 }], sources: 1 },
    });
    expect((call.data[0]?.extractedText as string).length).toBe(MAX_FEED_TEXT_CHARS);
    expect(call.data[1]?.extractedText).toBeNull();
    expect(await run(prismaIngestStore(prisma).saveFichas([]))).toBe(0);
  });

  it("records a good read by resetting the streak and the alert", async () => {
    const { prisma, mocks } = fakePrisma();
    expect(await run(prismaIngestStore(prisma).recordSource("s1", true, AT))).toEqual({
      consecutiveFailures: 0,
      alert: false,
    });
    expect(mocks.source.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { lastOkAt: AT, consecutiveFailures: 0, alertedAt: null },
    });
  });

  it("alerts once the streak reaches the limit, and only for the run that claims it", async () => {
    const below = fakePrisma({ failures: FAILURES_BEFORE_ALERT - 1 });
    expect(await run(prismaIngestStore(below.prisma).recordSource("s1", false, AT))).toEqual({
      consecutiveFailures: FAILURES_BEFORE_ALERT - 1,
      alert: false,
    });
    expect(below.mocks.source.updateMany).not.toHaveBeenCalled();

    const claimed = fakePrisma({ failures: FAILURES_BEFORE_ALERT, claimed: 1 });
    expect((await run(prismaIngestStore(claimed.prisma).recordSource("s1", false, AT))).alert).toBe(true);
    expect(claimed.mocks.source.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", alertedAt: null },
      data: { alertedAt: AT },
    });

    const already = fakePrisma({ failures: FAILURES_BEFORE_ALERT + 1, claimed: 0 });
    expect((await run(prismaIngestStore(already.prisma).recordSource("s1", false, AT))).alert).toBe(false);
  });

  it("fails with IngestDbFailed when the database does", async () => {
    const { prisma, mocks } = fakePrisma();
    mocks.article.findMany.mockRejectedValueOnce(new Error("connection lost"));
    const result = await run(Effect.either(prismaIngestStore(prisma).known(AT)));
    expect(result).toMatchObject({ _tag: "Left", left: { _tag: "IngestDbFailed", reason: "Error: connection lost" } });
  });
});
