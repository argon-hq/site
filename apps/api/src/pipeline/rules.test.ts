import { describe, expect, it } from "vitest";
import { canonicalize, isAllowedDomain, windowHours } from "./rules";

describe("collection rules", () => {
  it("allows only the listed domains and their subdomains", () => {
    expect(isAllowedDomain("https://valor.globo.com/empresas/x")).toBe(true);
    expect(isAllowedDomain("https://www.infomoney.com.br/negocios/y")).toBe(true);
    expect(isAllowedDomain("https://infomoney.com.br.evil.com/y")).toBe(false);
    expect(isAllowedDomain("https://g1.globo.com/economia")).toBe(false);
  });

  it("canonicalizes tracking noise away", () => {
    expect(canonicalize("https://exame.com/negocios/a/?utm_source=x&id=2#top")).toBe("https://exame.com/negocios/a?id=2");
  });

  it("opens a 48h window on Mondays, 24h otherwise", () => {
    expect(windowHours(new Date("2026-09-21T12:00:00-03:00"))).toBe(48); // Monday
    expect(windowHours(new Date("2026-09-22T12:00:00-03:00"))).toBe(24);
    expect(windowHours(new Date("2026-09-21T01:00:00Z"))).toBe(24); // still Sunday in São Paulo
  });
});
