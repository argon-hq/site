import { createTool } from "@mastra/core/tools";
import { Readability } from "@mozilla/readability";
import { Data, Effect, Schedule } from "effect";
import { parseHTML } from "linkedom";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { z } from "zod";
import { PROFILE } from "../../pipeline/profile";
import { isAllowedDomain } from "../../pipeline/rules";
import { extractedArticleSchema, type ExtractedArticle } from "../schemas/article";

// Hard rules live here, not in the prompt.
const TIMEOUT = "10 seconds";
export const MAX_HTML_BYTES = 2_000_000;
// How many redirects a page may take before it is given up on. Each hop is checked like the first.
export const MAX_REDIRECTS = 3;
const USER_AGENT = "ArgonNewsletterBot/0.1 (+https://argon.com.br)";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class FetchFailed extends Data.TaggedError("FetchFailed")<{ url: string; reason: string }> {}
export class PageUnreadable extends Data.TaggedError("PageUnreadable")<{ url: string; reason: string }> {}
// The tool is called by the agent with whatever URL it chooses, so the address is refused before
// anything is fetched: only the sources, only http(s), and never an address inside the machine's own
// network. A page from a source is the one thing this tool reads, and a page can tell the agent to
// read anything — this is what keeps "anything" from being the instance metadata.
export class UrlNotAllowed extends Data.TaggedError("UrlNotAllowed")<{ url: string; reason: string }> {}

// What the fetch depends on, so a test can answer the network and the resolver itself.
export type FetchDeps = {
  fetch: typeof fetch;
  lookup: (hostname: string) => Promise<{ address: string }[]>;
};

const liveDeps: FetchDeps = {
  fetch: (input, init) => fetch(input, init),
  lookup: (hostname) => dnsLookup(hostname, { all: true }),
};

// Loopback, link-local (the cloud metadata service lives there), private ranges, and the IPv6
// equivalents. An allowed source name that resolves here is not a source: it is something on the
// inside pretending to be one.
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    return true;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return false;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return false;
    // IPv4 mapped: judge the IPv4 inside.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1] as string);
    return true;
  }
  return false;
}

// The same three checks on the URL the agent asked for and on every redirect it is sent through.
const guardUrl = (url: string, deps: FetchDeps): Effect.Effect<URL, UrlNotAllowed> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => new URL(url),
      catch: () => new UrlNotAllowed({ url, reason: "not a valid url" }),
    });
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return yield* new UrlNotAllowed({ url, reason: `scheme ${parsed.protocol} not allowed` });
    }
    if (isIP(parsed.hostname.replace(/^\[|\]$/g, "")) !== 0) {
      return yield* new UrlNotAllowed({ url, reason: "ip address instead of a source name" });
    }
    if (!isAllowedDomain(url)) return yield* new UrlNotAllowed({ url, reason: "domain not allowed" });

    const addresses = yield* Effect.tryPromise({
      try: () => deps.lookup(parsed.hostname),
      catch: (error) => new UrlNotAllowed({ url, reason: `dns: ${String(error)}` }),
    });
    if (addresses.length === 0) return yield* new UrlNotAllowed({ url, reason: "dns: no address" });
    if (addresses.some((entry) => !isPublicAddress(entry.address))) {
      return yield* new UrlNotAllowed({ url, reason: "resolves to a private address" });
    }
    return parsed;
  });

// At most MAX_HTML_BYTES of the body, read as they arrive and cut when the limit is reached: a page
// that never ends must not be held in memory whole before it is sliced.
const readBody = (response: Response, url: string): Effect.Effect<string, FetchFailed> =>
  Effect.tryPromise({
    try: async () => {
      if (!response.body) return "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      const chunks: string[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const room = MAX_HTML_BYTES - bytes;
        const slice = value.byteLength > room ? value.subarray(0, room) : value;
        chunks.push(decoder.decode(slice, { stream: true }));
        bytes += slice.byteLength;
        if (bytes >= MAX_HTML_BYTES) {
          await reader.cancel();
          break;
        }
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    },
    catch: (error) => new FetchFailed({ url, reason: String(error) }),
  });

// Follows redirects by hand so each destination is checked like the first address. The response
// that comes back is the final one, together with the address it was read from.
const fetchGuarded = (
  url: string,
  deps: FetchDeps,
  signal: AbortSignal,
): Effect.Effect<{ response: Response; url: string }, FetchFailed | UrlNotAllowed> =>
  Effect.gen(function* () {
    let current = url;
    for (let hop = 0; ; hop++) {
      const target = yield* guardUrl(current, deps);
      const response = yield* Effect.tryPromise({
        try: () =>
          deps.fetch(target.toString(), {
            headers: { "user-agent": USER_AGENT, accept: "text/html" },
            signal,
            redirect: "manual",
          }),
        catch: (error) => new FetchFailed({ url: current, reason: String(error) }),
      });
      if (!REDIRECT_STATUSES.has(response.status)) return { response, url: current };

      const location = response.headers.get("location");
      yield* Effect.promise(() => response.body?.cancel() ?? Promise.resolve());
      if (!location)
        return yield* new FetchFailed({ url: current, reason: `HTTP ${response.status} without location` });
      if (hop + 1 > MAX_REDIRECTS) return yield* new FetchFailed({ url: current, reason: "too many redirects" });
      current = new URL(location, current).toString();
    }
  });

// One attempt: guard, fetch, parse, extract. Network errors are retried by the caller; refused
// addresses and unreadable pages are not.
const fetchOnce = (
  url: string,
  deps: FetchDeps,
): Effect.Effect<ExtractedArticle, FetchFailed | PageUnreadable | UrlNotAllowed> =>
  Effect.gen(function* () {
    const controller = new AbortController();
    const { response, url: finalUrl } = yield* fetchGuarded(url, deps, controller.signal).pipe(
      Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
    );
    if (!response.ok) return yield* new FetchFailed({ url: finalUrl, reason: `HTTP ${response.status}` });

    const type = response.headers.get("content-type") ?? "";
    if (type && !/^(text\/html|application\/xhtml\+xml)/i.test(type)) {
      return yield* new PageUnreadable({ url: finalUrl, reason: `not html: ${type}` });
    }

    const html = yield* readBody(response, finalUrl);
    const { document } = parseHTML(html);
    const canonical =
      document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute("href") ?? finalUrl;
    const published =
      document.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ??
      document.querySelector("time[datetime]")?.getAttribute("datetime") ??
      null;

    const article = new Readability(document).parse();
    if (!article?.textContent?.trim()) return yield* new PageUnreadable({ url: finalUrl, reason: "no readable text" });

    return {
      canonicalUrl: new URL(canonical, finalUrl).toString(),
      originalTitle: article.title?.trim() || document.title.trim(),
      extractedText: article.textContent.replace(/\s+\n/g, "\n").trim().slice(0, PROFILE.maxTextChars),
      siteName: article.siteName ?? null,
      publishedAt: published,
    };
  });

// Timeout per attempt, two retries with backoff on network errors only.
export const fetchArticle = (url: string, deps: FetchDeps = liveDeps) =>
  fetchOnce(url, deps).pipe(
    Effect.timeoutFail({ duration: TIMEOUT, onTimeout: () => new FetchFailed({ url, reason: "timeout" }) }),
    Effect.retry({
      schedule: Schedule.exponential("500 millis"),
      times: 2,
      while: (error) => error._tag === "FetchFailed",
    }),
  );

const readPageInput = z.object({ url: z.url() });

export const readPage = createTool({
  id: "read_page",
  description:
    "Lê uma página de notícia de uma das fontes e devolve título, texto principal, data de publicação e URL canônica.",
  inputSchema: readPageInput,
  outputSchema: extractedArticleSchema,
  // Promise boundary: Mastra calls the tool, the effect runs here. The input is parsed again on
  // the way in: what Mastra types it as depends on its zod version, not on this schema.
  execute: (input) => Effect.runPromise(fetchArticle(readPageInput.parse(input).url)),
});
