import type { LoggerService } from "@nestjs/common";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { PageUnreadable } from "../mastra/tools/read-page";
import { persistCandidate, type PersistContext, type ReadPage } from "./persist";

const silent: LoggerService = { log: () => {}, warn: () => {}, error: () => {} };

// `stored` are the canonical urls already in the article table.
function ctx(stored: string[] = []) {
  const mocks = {
    seenUrl: { upsert: vi.fn(async () => ({})) },
    article: {
      findUnique: vi.fn(async ({ where }: { where: { canonicalUrl: string } }) =>
        stored.includes(where.canonicalUrl) ? { id: "1" } : null,
      ),
      create: vi.fn(async () => ({ id: "2" })),
    },
  };
  const context: PersistContext = {
    prisma: mocks as unknown as PrismaClient,
    since: new Date("2026-09-17T00:00:00Z"),
    cutoff: 3,
    logger: silent,
  };
  return Object.assign(context, { mocks });
}

const page =
  (publishedAt: string | null, canonicalUrl?: string): ReadPage =>
  (url) =>
    Effect.succeed({
      canonicalUrl: canonicalUrl ?? url,
      originalTitle: "Título da página",
      extractedText: "texto",
      siteName: "Valor",
      publishedAt,
    });

const candidate = {
  url: "https://valor.globo.com/empresas/noticia/2026/09/18/x.ghtml?utm_source=a",
  sourceName: "Valor",
  title: "t",
  score: 4,
  rationale: "r",
};

describe("persistCandidate", () => {
  it("saves above the cutoff with the page's own text and date", async () => {
    const c = ctx();
    const out = await Effect.runPromise(persistCandidate(candidate, c, page("2026-09-18T10:00:00Z")));
    expect(out).toEqual({ outcome: "saved", url: "https://valor.globo.com/empresas/noticia/2026/09/18/x.ghtml", publishedAt: "2026-09-18T10:00:00.000Z" });
    expect(c.mocks.seenUrl.upsert).toHaveBeenCalledOnce();
    expect(c.mocks.article.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ originalTitle: "Título da página", score: 4 }) }));
  });

  it("below the cutoff only marks the link as seen, without reading the page", async () => {
    const c = ctx();
    const read = vi.fn(page("2026-09-18T10:00:00Z"));
    expect((await Effect.runPromise(persistCandidate({ ...candidate, score: 2 }, c, read))).outcome).toBe("below_cutoff");
    expect(c.mocks.seenUrl.upsert).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(c.mocks.article.create).not.toHaveBeenCalled();
  });

  it("rejects other domains before touching the database, and old or unreadable pages after marking them seen", async () => {
    const c = ctx();
    expect(await Effect.runPromise(persistCandidate({ ...candidate, url: "https://g1.globo.com/x" }, c, page(null)))).toMatchObject({ outcome: "rejected", reason: "domain not allowed" });
    expect(c.mocks.seenUrl.upsert).not.toHaveBeenCalled();
    expect(await Effect.runPromise(persistCandidate(candidate, c, page("2026-09-10T00:00:00Z")))).toMatchObject({ outcome: "rejected", reason: "outside window" });
    const unreadable: ReadPage = (url) => Effect.fail(new PageUnreadable({ url, reason: "no readable text" }));
    expect(await Effect.runPromise(persistCandidate(candidate, c, unreadable))).toMatchObject({ outcome: "rejected", reason: "PageUnreadable: no readable text" });
    expect(c.mocks.article.create).not.toHaveBeenCalled();
  });

  it("reports duplicates", async () => {
    const c = ctx(["https://valor.globo.com/empresas/noticia/2026/09/18/x.ghtml"]);
    expect((await Effect.runPromise(persistCandidate(candidate, c, page(null)))).outcome).toBe("duplicate");
    expect(c.mocks.article.create).not.toHaveBeenCalled();
  });

  it("stores the page's own canonical url and marks both links as seen", async () => {
    const c = ctx();
    const read = page("2026-09-18T10:00:00Z", "https://www.valor.globo.com/empresas/noticia/2026/09/18/x.ghtml?ref=home");
    const out = await Effect.runPromise(persistCandidate({ ...candidate, url: "https://valor.globo.com/amp/empresas/x.ghtml" }, c, read));
    expect(out).toEqual({ outcome: "saved", url: "https://valor.globo.com/empresas/noticia/2026/09/18/x.ghtml", publishedAt: "2026-09-18T10:00:00.000Z" });
    expect(c.mocks.seenUrl.upsert).toHaveBeenCalledTimes(2);
    expect(c.mocks.article.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ canonicalUrl: "https://valor.globo.com/empresas/noticia/2026/09/18/x.ghtml" }) }));
  });

  it("is a duplicate when the page's canonical url is already stored under another link", async () => {
    const c = ctx(["https://valor.globo.com/empresas/noticia/2026/09/18/x.ghtml"]);
    const read = page(null, "https://valor.globo.com/empresas/noticia/2026/09/18/x.ghtml");
    const out = await Effect.runPromise(persistCandidate({ ...candidate, url: "https://valor.globo.com/amp/empresas/x.ghtml" }, c, read));
    expect(out).toEqual({ outcome: "duplicate", url: "https://valor.globo.com/empresas/noticia/2026/09/18/x.ghtml" });
    expect(c.mocks.article.create).not.toHaveBeenCalled();
  });

  it("rejects a canonical url that leaves the allowlist", async () => {
    const c = ctx();
    const read = page(null, "https://g1.globo.com/economia/x");
    expect(await Effect.runPromise(persistCandidate(candidate, c, read))).toMatchObject({ outcome: "rejected", reason: "canonical url outside the allowlist" });
    expect(c.mocks.article.create).not.toHaveBeenCalled();
  });
});
