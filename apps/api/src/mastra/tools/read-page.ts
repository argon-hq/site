import { createTool } from "@mastra/core/tools";
import { Readability } from "@mozilla/readability";
import { Data, Effect, Schedule } from "effect";
import { parseHTML } from "linkedom";
import { z } from "zod";
import {
  fetchBody,
  FetchFailed,
  liveDeps,
  type Allowed,
  type BodyTooLarge,
  type FetchDeps,
  type UnexpectedType,
  type UrlNotAllowed,
} from "../../net/fetch";
import { PROFILE } from "../../pipeline/profile";
import { isAllowedDomain } from "../../pipeline/rules";
import { extractedArticleSchema, type ExtractedArticle } from "../schemas/article";

export { FetchFailed, isPublicAddress, UrlNotAllowed, type FetchDeps } from "../../net/fetch";

// Hard rules live here, not in the prompt.
export const MAX_HTML_BYTES = 2_000_000;
const HTML = /^(text\/html|application\/xhtml\+xml)/i;

export class PageUnreadable extends Data.TaggedError("PageUnreadable")<{ url: string; reason: string }> {}

// One attempt: fetch the page under its deadline, then parse and extract. Network errors are
// retried by the caller; refused addresses and unreadable pages are not. A page over the limit is
// cut, not refused: the article is at the top and the rest is footer.
const fetchOnce = (
  url: string,
  deps: FetchDeps,
  allowed: Allowed,
): Effect.Effect<ExtractedArticle, FetchFailed | PageUnreadable | UrlNotAllowed> =>
  Effect.gen(function* () {
    const body = yield* fetchBody(url, {
      allowed,
      deps,
      accept: "text/html",
      types: HTML,
      maxBytes: MAX_HTML_BYTES,
      overflow: "cut",
      timeout: "10 seconds",
    }).pipe(
      Effect.catchTag("UnexpectedType", (e: UnexpectedType) => new PageUnreadable({ url: e.url, reason: e.reason })),
      Effect.catchTag("BodyTooLarge", (e: BodyTooLarge) => new PageUnreadable({ url: e.url, reason: e.reason })),
    );
    const finalUrl = body.url;
    const html = body.text;
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

// Two retries with backoff on network errors only. Only the sources' domains may be read, unless
// the caller names its own allowlist.
export const fetchArticle = (url: string, deps: FetchDeps = liveDeps, allowed: Allowed = isAllowedDomain) =>
  fetchOnce(url, deps, allowed).pipe(
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
