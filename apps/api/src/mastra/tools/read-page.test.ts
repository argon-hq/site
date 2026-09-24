import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import { fetchArticle, isPublicAddress, MAX_HTML_BYTES, type FetchDeps } from "./read-page";

const ARTICLE = `<!doctype html><html><head><title>Copom mantém a Selic</title>
<link rel="canonical" href="https://valor.globo.com/financas/noticia/copom.ghtml">
<meta property="article:published_time" content="2026-09-24T09:00:00-03:00"></head>
<body><article><h1>Copom mantém a Selic</h1>${"<p>O Comitê de Política Monetária manteve a taxa básica de juros e sinalizou cautela com a inflação de serviços. </p>".repeat(8)}</article></body></html>`;

type Answer = { status?: number; headers?: Record<string, string>; body?: string | ReadableStream<Uint8Array> };

// A fake network: one answer per URL, and a resolver that says every source is public unless told.
function deps(answers: Record<string, Answer>, addresses: Record<string, string> = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const answer = answers[url];
    if (!answer) throw new Error(`no answer for ${url}`);
    return new Response(answer.body ?? "", {
      status: answer.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...answer.headers },
    });
  });
  const fakeDeps: FetchDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    lookup: async (hostname) => [{ address: addresses[hostname] ?? "200.1.2.3" }],
  };
  return { deps: fakeDeps, calls };
}

const failure = async (effect: ReturnType<typeof fetchArticle>) => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const cause = exit.cause;
  return cause._tag === "Fail" ? cause.error : null;
};

describe("isPublicAddress", () => {
  it("refuses loopback, link-local, private and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:169.254.169.254"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("accepts public addresses", () => {
    for (const ip of ["200.1.2.3", "8.8.8.8", "172.32.0.1", "2001:db8::1", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe("fetchArticle", () => {
  it("reads a page from a source", async () => {
    const { deps: d } = deps({ "https://valor.globo.com/financas/noticia/copom.ghtml": { body: ARTICLE } });
    const page = await Effect.runPromise(fetchArticle("https://valor.globo.com/financas/noticia/copom.ghtml", d));
    expect(page.canonicalUrl).toBe("https://valor.globo.com/financas/noticia/copom.ghtml");
    expect(page.originalTitle).toBe("Copom mantém a Selic");
    expect(page.publishedAt).toBe("2026-09-24T09:00:00-03:00");
    expect(page.extractedText).toContain("Comitê de Política Monetária");
  });

  it("refuses a domain outside the sources before fetching anything", async () => {
    const { deps: d, calls } = deps({});
    const error = await failure(fetchArticle("https://example.com/news", d));
    expect(error?._tag).toBe("UrlNotAllowed");
    expect(calls).toEqual([]);
  });

  it("refuses an ip address, the metadata service included", async () => {
    const { deps: d, calls } = deps({});
    const error = await failure(fetchArticle("http://169.254.169.254/latest/meta-data/", d));
    expect(error?._tag).toBe("UrlNotAllowed");
    expect(calls).toEqual([]);
  });

  it("refuses a source name that resolves to a private address", async () => {
    const { deps: d, calls } = deps({}, { "valor.globo.com": "10.0.0.7" });
    const error = await failure(fetchArticle("https://valor.globo.com/x", d));
    expect(error?._tag).toBe("UrlNotAllowed");
    expect(error && "reason" in error ? error.reason : "").toContain("private");
    expect(calls).toEqual([]);
  });

  it("refuses a scheme other than http(s)", async () => {
    const { deps: d } = deps({});
    const error = await failure(fetchArticle("file:///etc/passwd", d));
    expect(error?._tag).toBe("UrlNotAllowed");
  });

  it("follows a redirect inside the sources and checks the destination like the first address", async () => {
    const { deps: d, calls } = deps({
      "https://valor.globo.com/short": { status: 302, headers: { location: "/financas/noticia/copom.ghtml" } },
      "https://valor.globo.com/financas/noticia/copom.ghtml": { body: ARTICLE },
    });
    const page = await Effect.runPromise(fetchArticle("https://valor.globo.com/short", d));
    expect(page.canonicalUrl).toBe("https://valor.globo.com/financas/noticia/copom.ghtml");
    expect(calls).toHaveLength(2);
  });

  it("refuses a redirect that leaves the sources", async () => {
    const { deps: d, calls } = deps({
      "https://valor.globo.com/out": { status: 301, headers: { location: "http://169.254.169.254/latest/" } },
    });
    const error = await failure(fetchArticle("https://valor.globo.com/out", d));
    expect(error?._tag).toBe("UrlNotAllowed");
    expect(calls).toEqual(["https://valor.globo.com/out"]);
  });

  it("gives up after too many redirects", async () => {
    const { deps: d } = deps({
      "https://valor.globo.com/a": { status: 302, headers: { location: "/b" } },
      "https://valor.globo.com/b": { status: 302, headers: { location: "/c" } },
      "https://valor.globo.com/c": { status: 302, headers: { location: "/d" } },
      "https://valor.globo.com/d": { status: 302, headers: { location: "/e" } },
      "https://valor.globo.com/e": { status: 302, headers: { location: "/f" } },
    });
    const error = await failure(fetchArticle("https://valor.globo.com/a", d));
    expect(error?._tag).toBe("FetchFailed");
    expect(error && "reason" in error ? error.reason : "").toContain("redirects");
  }, 15_000);

  it("stops reading a body that goes past the limit", async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode(`<p>${"x".repeat(65_536 - 7)}</p>`);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { deps: d } = deps({ "https://valor.globo.com/endless": { body: endless } });
    const exit = await Effect.runPromiseExit(fetchArticle("https://valor.globo.com/endless", d));
    // Readability may or may not find an article in a page cut mid-way; what matters is the read stopped.
    expect(cancelled).toBe(true);
    expect(pulled * chunk.byteLength).toBeLessThan(MAX_HTML_BYTES + 4 * chunk.byteLength);
    if (Exit.isSuccess(exit)) expect(exit.value.extractedText.length).toBeLessThanOrEqual(MAX_HTML_BYTES);
  }, 15_000);

  it("refuses a response that is not html", async () => {
    const { deps: d } = deps({ "https://valor.globo.com/file.pdf": { body: "%PDF", headers: { "content-type": "application/pdf" } } });
    const error = await failure(fetchArticle("https://valor.globo.com/file.pdf", d));
    expect(error?._tag).toBe("PageUnreadable");
  });
});
