import { describe, expect, it } from "vitest";
import { CATALOG, catalogSources } from "./catalog";
import { sectionRuleSchema } from "./source";
import { hostInDomain } from "./url";

describe("the sources catalogue", () => {
  it("has one entry per domain, each with valid section rules", () => {
    expect(new Set(CATALOG.map((s) => s.domain)).size).toBe(CATALOG.length);
    for (const source of CATALOG) expect(sectionRuleSchema.array().safeParse(source.sectionRules).success).toBe(true);
  });

  it("reads every address over https and on the source's own domain", () => {
    for (const source of CATALOG) {
      expect(source.feeds.length, source.domain).toBeGreaterThan(0);
      for (const feed of source.feeds) {
        const url = new URL(feed.url);
        expect(url.protocol).toBe("https:");
        expect(hostInDomain(url.hostname, source.domain), feed.url).toBe(true);
      }
    }
  });

  it("runs only the active sources; Gartner and Forbes US wait for the source review", () => {
    const active = catalogSources().map((s) => s.domain);
    expect(active).not.toContain("gartner.com");
    expect(active).not.toContain("forbes.com");
    expect(active).toHaveLength(6);
  });

  it("drops Folha's live blogs by host", () => {
    const folha = CATALOG.find((s) => s.domain === "folha.uol.com.br");
    expect(folha?.sectionRules).toContainEqual({ match: "host", pattern: "aovivo.", tier: "discard" });
  });
});
