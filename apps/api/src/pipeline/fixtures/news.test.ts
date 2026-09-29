import { describe, expect, it } from "vitest";
import { PROFILES } from "../profile";
import { canonicalize, isAllowedDomain, windowStart } from "../rules";
import { fixtureNews } from "./news";

const now = new Date("2026-09-23T08:30:00Z"); // 5h30 in São Paulo

describe("the collection fixture", () => {
  it("only carries links the persistence would accept", () => {
    for (const { candidate, page } of fixtureNews(now)) {
      expect(isAllowedDomain(candidate.url)).toBe(true);
      expect(canonicalize(candidate.url)).toBe(candidate.url); // nothing for the canonical form to fix
      expect(page.canonicalUrl).toBe(candidate.url);
    }
  });

  it("brings different news every day, or the second run would find only duplicates", () => {
    const today = fixtureNews(now).map((item) => item.candidate.url);
    const tomorrow = fixtureNews(new Date("2026-09-24T08:30:00Z")).map((item) => item.candidate.url);

    expect(new Set(today).size).toBe(today.length);
    expect(today.some((url) => tomorrow.includes(url))).toBe(false);
  });

  it("publishes inside the window the collection looks at", () => {
    const since = windowStart(now);
    for (const { page } of fixtureNews(now)) {
      expect(new Date(page.publishedAt!).getTime()).toBeGreaterThan(since.getTime());
      expect(new Date(page.publishedAt!).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it("leaves enough above the cutoff for an edition to close in every environment", () => {
    for (const profile of Object.values(PROFILES)) {
      const above = fixtureNews(now).filter((item) => item.candidate.score >= profile.scoreCutoff);
      expect(above.length).toBeGreaterThanOrEqual(profile.minArticles);
    }
  });

  it("says in the text itself that the news is invented", () => {
    for (const { page } of fixtureNews(now)) expect(page.extractedText).toContain("Texto de exemplo da Argon");
  });
});
