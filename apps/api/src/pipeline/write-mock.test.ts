import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { editionHeaderSchema, writtenItemSchema } from "../mastra/schemas/edition";
import { fixtureNews } from "./fixtures/news";
import type { Candidate } from "./write";
import { mockHeader, mockItem } from "./write-mock";

const article = (over: Partial<Candidate> = {}): Candidate => {
  const news = fixtureNews(new Date("2026-09-23T08:30:00Z"))[0]!;
  return {
    id: "a1",
    canonicalUrl: news.candidate.url,
    sourceName: news.candidate.sourceName,
    originalTitle: news.page.originalTitle,
    extractedText: news.page.extractedText,
    ...over,
  };
};

describe("the mocked writing", () => {
  it("answers what the schema of a written item demands", async () => {
    const written = await Effect.runPromise(mockItem(article())("ignored"));

    expect(writtenItemSchema.safeParse(written.object).success).toBe(true);
    expect(written.object.headline).toBe(article().originalTitle);
  });

  it("cuts a long article to the body limit without breaking a word", async () => {
    const written = await Effect.runPromise(mockItem(article())("ignored"));

    expect(written.object.body.length).toBeLessThanOrEqual(190);
    expect(written.object.body).not.toMatch(/\s$/);
    expect(article().extractedText.startsWith(written.object.body.slice(0, 40))).toBe(true);
  });

  it("keeps a headline inside the limit even when the title is long", async () => {
    const long = article({ originalTitle: "Palavra ".repeat(40) });
    const written = await Effect.runPromise(mockItem(long)("ignored"));

    expect(writtenItemSchema.safeParse(written.object).success).toBe(true);
    expect(written.object.headline.length).toBeLessThanOrEqual(120);
  });

  it("answers a header the schema accepts, from the day and the first headline", async () => {
    const items = [{ category: "business" as const, headline: "Crédito cresce 12%", body: "Corpo." }];
    const header = await Effect.runPromise(mockHeader(items, "2026-09-23")("ignored"));

    expect(editionHeaderSchema.safeParse(header.object).success).toBe(true);
    expect(header.object.title).toContain("2026-09-23");
    expect(header.object.subject).toBe("Crédito cresce 12%");
  });

  it("still answers a header when nothing was written", async () => {
    const header = await Effect.runPromise(mockHeader([], "2026-09-23")("ignored"));

    expect(editionHeaderSchema.safeParse(header.object).success).toBe(true);
  });
});
