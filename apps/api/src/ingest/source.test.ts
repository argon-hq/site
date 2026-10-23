import { describe, expect, it } from "vitest";
import { sectionOf, type SectionRule } from "./source";

const rules: SectionRule[] = [
  { match: "path", pattern: "/empresas/coluna/", tier: "discard" },
  { match: "path", pattern: "/empresas/", tier: "core" },
  { match: "path", pattern: "/mundo/", tier: "peripheral" },
  { match: "host", pattern: "aovivo.", tier: "discard" },
  { match: "category", pattern: "Forbes Money", tier: "adjacent" },
];

const section = (url: string, categories: string[] = []) => sectionOf(new URL(url), categories, rules);

describe("sectionOf", () => {
  it("gives the tier of the first rule that matches, and names it", () => {
    expect(section("https://x.test/empresas/a")).toEqual({ tier: "core", rule: "path:/empresas/" });
    expect(section("https://x.test/mundo/a")).toEqual({ tier: "peripheral", rule: "path:/mundo/" });
  });

  it("lets a discard rule win over any other match, wherever it is in the list", () => {
    expect(section("https://x.test/empresas/coluna/a").tier).toBe("discard");
    expect(section("https://aovivo.x.test/empresas/a")).toEqual({ tier: "discard", rule: "host:aovivo." });
  });

  it("matches a category, and compares path, host and category in lowercase", () => {
    expect(section("https://x.test/a", ["forbes money"]).tier).toBe("adjacent");
    expect(section("https://x.test/Empresas/A").tier).toBe("core");
    expect(section("https://AOVIVO.x.test/a").tier).toBe("discard");
  });

  it("is neutral when no rule names the section", () => {
    expect(section("https://x.test/cidades/a")).toEqual({ tier: "neutral", rule: null });
  });
});
