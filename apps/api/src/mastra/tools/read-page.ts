import { createTool } from "@mastra/core/tools";
import { Readability } from "@mozilla/readability";
import { Data, Effect, Schedule } from "effect";
import { parseHTML } from "linkedom";
import { z } from "zod";
import {
  charsetOf,
  decode,
  fetchGuarded,
  FetchFailed,
  liveDeps,
  readBytes,
  type Allowed,
  type FetchDeps,
  type UrlNotAllowed,
} from "../../net/fetch";
import { PROFILE } from "../../pipeline/profile";
import { isAllowedDomain } from "../../pipeline/rules";
import { extractedArticleSchema, type ExtractedArticle } from "../schemas/article";

export { FetchFailed, isPublicAddress, UrlNotAllowed, type FetchDeps } from "../../net/fetch";

// Hard rules live here, not in the prompt.
const TIMEOUT = "10 seconds";
export const MAX_HTML_BYTES = 2_000_000;

export class PageUnreadable extends Data.TaggedError("PageUnreadable")<{ url: string; reason: string }> {}

// One attempt: guard, fetch, parse, extract. Network errors are retried by the caller; refused
// addresses and unreadable pages are not.
const fetchOnce = (
  url: string,
  deps: FetchDeps,
  allowed: Allowed,
): Effect.Effect<ExtractedArticle, FetchFailed | PageUnreadable | UrlNotAllowed> =>
  Effect.gen(function* () {
    const controller = new AbortController();
    const { response, url: finalUrl } = yield* fetchGuarded(url, {
      allowed,
      deps,
      accept: "text/html",
      signal: controller.signal,
    }).pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())));
    if (!response.ok)
      return yield* new FetchFailed({ url: finalUrl, reason: `HTTP ${response.status}`, status: response.status });

    const type = response.headers.get("content-type") ?? "";
    if (type && !/^(text\/html|application\/xhtml\+xml)/i.test(type)) {
      return yield* new PageUnreadable({ url: finalUrl, reason: `not html: ${type}` });
    }

    const bytes = yield* readBytes(response, finalUrl, MAX_HTML_BYTES);
    const html = decode(bytes, charsetOf(type, bytes));
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

// Timeout per attempt, two retries with backoff on network errors only. Only the sources' domains
// may be read, unless the caller names its own allowlist.
export const fetchArticle = (url: string, deps: FetchDeps = liveDeps, allowed: Allowed = isAllowedDomain) =>
  fetchOnce(url, deps, allowed).pipe(
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
