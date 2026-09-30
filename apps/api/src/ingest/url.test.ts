import { describe, expect, it } from "vitest";
import { canonicalize, domainOf, hostInDomain, unwrapRedirect, urlHash } from "./url";

describe("canonicalize", () => {
  it("canonicalizes tracking noise away", () => {
    expect(canonicalize("https://exame.com/negocios/a/?utm_source=x&id=2#top")).toBe(
      "https://exame.com/negocios/a?id=2",
    );
  });

  it("gives the same key to the same article reached by different links", () => {
    const key = "https://exame.com/negocios/a?id=2&p=1";
    expect(canonicalize("https://www.Exame.com/negocios/a?p=1&id=2")).toBe(key);
    expect(canonicalize("https://exame.com/negocios/a/?id=2&p=1&fbclid=z")).toBe(key);
  });
});

describe("unwrapRedirect", () => {
  it("takes the real address out of the Folha redirector", () => {
    const link =
      "https://redir.folha.com.br/redir/online/mercado/rss091/*https://www1.folha.uol.com.br/mercado/2026/09/x.shtml";
    expect(unwrapRedirect(link)).toBe("https://www1.folha.uol.com.br/mercado/2026/09/x.shtml");
  });

  it("leaves a plain link alone, and a marker without a URL after it", () => {
    expect(unwrapRedirect("https://valor.globo.com/empresas/a")).toBe("https://valor.globo.com/empresas/a");
    expect(unwrapRedirect("https://x.test/a*http")).toBe("https://x.test/a*http");
  });
});

describe("domains", () => {
  it("accepts the domain and its subdomains, never a look-alike", () => {
    expect(hostInDomain("www1.folha.uol.com.br", "folha.uol.com.br")).toBe(true);
    expect(hostInDomain("folha.uol.com.br", "folha.uol.com.br")).toBe(true);
    expect(hostInDomain("folha.uol.com.br.evil.test", "folha.uol.com.br")).toBe(false);
    expect(hostInDomain("forbes.com.br", "forbes.com")).toBe(false);
  });

  it("finds which domain a link belongs to", () => {
    expect(domainOf("https://www.infomoney.com.br/x", ["valor.globo.com", "infomoney.com.br"])).toBe(
      "infomoney.com.br",
    );
    expect(domainOf("https://g1.globo.com/x", ["valor.globo.com"])).toBeNull();
  });
});

describe("urlHash", () => {
  it("is the sha256 of the canonical link, stable and never the link itself", () => {
    const hash = urlHash("https://exame.com/negocios/a");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(urlHash("https://exame.com/negocios/a"));
    expect(hash).not.toBe(urlHash("https://exame.com/negocios/b"));
  });
});
