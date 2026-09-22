import { describe, expect, it } from "vitest";
import { ALLOWED_DOMAINS, canonicalize, editionDate, isAllowedDomain, SOURCES, windowHours } from "./rules";

describe("collection rules", () => {
  it("allows only the listed domains and their subdomains", () => {
    expect(isAllowedDomain("https://valor.globo.com/empresas/x")).toBe(true);
    expect(isAllowedDomain("https://www.infomoney.com.br/negocios/y")).toBe(true);
    expect(isAllowedDomain("https://infomoney.com.br.evil.com/y")).toBe(false);
    expect(isAllowedDomain("https://g1.globo.com/economia")).toBe(false);
  });

  it("keeps one list of sources for the allowlist and the prompt", () => {
    expect(ALLOWED_DOMAINS).toEqual(SOURCES.map((s) => s.domain));
    expect(SOURCES.every((s) => s.name && s.covers)).toBe(true);
  });

  it("canonicalizes tracking noise away", () => {
    expect(canonicalize("https://exame.com/negocios/a/?utm_source=x&id=2#top")).toBe("https://exame.com/negocios/a?id=2");
  });

  it("gives the same key to the same article reached by different links", () => {
    const key = "https://exame.com/negocios/a?id=2&p=1";
    expect(canonicalize("https://www.Exame.com/negocios/a?p=1&id=2")).toBe(key);
    expect(canonicalize("https://exame.com/negocios/a/?id=2&p=1&fbclid=z")).toBe(key);
  });

  it("opens a 48h window on Mondays, 24h otherwise", () => {
    expect(windowHours(new Date("2026-09-21T12:00:00-03:00"))).toBe(48); // Monday
    expect(windowHours(new Date("2026-09-22T12:00:00-03:00"))).toBe(24);
    expect(windowHours(new Date("2026-09-21T01:00:00Z"))).toBe(24); // still Sunday in São Paulo
  });

  it("dates the edition by the São Paulo calendar day", () => {
    expect(editionDate(new Date("2026-09-22T08:30:00Z")).toISOString()).toBe("2026-09-22T00:00:00.000Z");
    // 21:00 in São Paulo, already the 23rd in UTC: the edition is still the 22nd.
    expect(editionDate(new Date("2026-09-23T00:00:00Z")).toISOString()).toBe("2026-09-22T00:00:00.000Z");
  });
});
