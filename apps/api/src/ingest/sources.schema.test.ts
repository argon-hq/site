import { describe, expect, it } from "vitest";
import { domainSchema, feedInputSchema, sourceCreateSchema, sourcePatchSchema } from "./sources.schema";

describe("the sources schema", () => {
  it("takes a domain as a lowercase name, never an address or a URL", () => {
    expect(domainSchema.parse(" Valor.Globo.com ")).toBe("valor.globo.com");
    expect(domainSchema.safeParse("10.0.0.1").success).toBe(false);
    expect(domainSchema.safeParse("https://valor.globo.com").success).toBe(false);
    expect(domainSchema.safeParse("localhost").success).toBe(false);
  });

  it("takes a feed only over https and on a name", () => {
    expect(feedInputSchema.safeParse({ kind: "feed", url: "https://exame.com/feed/" }).success).toBe(true);
    expect(feedInputSchema.safeParse({ kind: "feed", url: "http://exame.com/feed/" }).success).toBe(false);
    expect(feedInputSchema.safeParse({ kind: "feed", url: "https://169.254.169.254/latest" }).success).toBe(false);
    expect(feedInputSchema.safeParse({ kind: "rss", url: "https://exame.com/feed/" }).success).toBe(false);
  });

  it("refuses a feed that is not on the source's domain", () => {
    const base = { domain: "folha.uol.com.br", name: "Folha", covers: "mercado" };
    expect(
      sourceCreateSchema.safeParse({ ...base, feeds: [{ kind: "feed", url: "https://feeds.folha.uol.com.br/x.xml" }] })
        .success,
    ).toBe(true);
    const outside = sourceCreateSchema.safeParse({
      ...base,
      feeds: [{ kind: "feed", url: "https://evil.test/x.xml" }],
    });
    expect(outside.success).toBe(false);
    expect(outside.error?.issues[0]?.path).toEqual(["feeds", 0, "url"]);
  });

  it("defaults a new source to active, no trust, no rules", () => {
    expect(sourceCreateSchema.parse({ domain: "exame.com", name: "Exame", covers: "PME" })).toMatchObject({
      trust: 0,
      active: true,
      sectionRules: [],
      feeds: [],
    });
  });

  it("validates the section rules and the trust of a change, and refuses an empty change", () => {
    expect(sourcePatchSchema.safeParse({ active: false }).success).toBe(true);
    expect(
      sourcePatchSchema.safeParse({ sectionRules: [{ match: "host", pattern: "aovivo.", tier: "discard" }] }).success,
    ).toBe(true);
    expect(sourcePatchSchema.safeParse({ trust: 2 }).success).toBe(false);
    expect(
      sourcePatchSchema.safeParse({ sectionRules: [{ match: "path", pattern: "/live/", tier: "drop" }] }).success,
    ).toBe(false);
    expect(sourcePatchSchema.safeParse({}).success).toBe(false);
  });
});
