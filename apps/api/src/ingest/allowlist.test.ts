import { afterEach, describe, expect, it } from "vitest";
import { allowedDomains, isAllowedDomain, setAllowedDomains } from "./allowlist";

describe("the allowlist", () => {
  afterEach(() => setAllowedDomains([]));

  it("refuses everything until the sources are loaded", () => {
    setAllowedDomains([]);
    expect(isAllowedDomain("https://valor.globo.com/empresas/x")).toBe(false);
  });

  it("allows the active sources' domains and their subdomains", () => {
    setAllowedDomains(["valor.globo.com", "Infomoney.com.br"]);
    expect(isAllowedDomain("https://valor.globo.com/empresas/x")).toBe(true);
    expect(isAllowedDomain("https://www.infomoney.com.br/negocios/y")).toBe(true);
    expect(isAllowedDomain("https://infomoney.com.br.evil.com/y")).toBe(false);
    expect(isAllowedDomain("https://g1.globo.com/economia")).toBe(false);
    expect(isAllowedDomain("not a url")).toBe(false);
  });

  it("follows the table: a source turned off leaves on the next load", () => {
    setAllowedDomains(["valor.globo.com", "exame.com"]);
    setAllowedDomains(["valor.globo.com"]);
    expect(allowedDomains()).toEqual(["valor.globo.com"]);
    expect(isAllowedDomain("https://exame.com/negocios/a")).toBe(false);
  });
});
