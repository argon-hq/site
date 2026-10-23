import { createTool } from "@mastra/core/tools";
import { Readability } from "@mozilla/readability";
import { Logger } from "@nestjs/common";
import { Data, Effect, Schedule } from "effect";
import { parseHTML } from "linkedom";
import { z } from "zod";
import { isAllowedDomain } from "../../ingest/allowlist";
import {
  fetchBody,
  liveDeps,
  type Allowed,
  type FetchDeps,
  type FetchFailed,
  type UrlNotAllowed,
} from "../../net/fetch";
import { PROFILE } from "../../pipeline/profile";
import { extractedArticleSchema, type ExtractedArticle } from "../schemas/article";

// Hard rules live here, not in the prompt.
export const MAX_HTML_BYTES = 2_000_000;
const TIMEOUT = "10 seconds";
const HTML = /^(text\/html|application\/xhtml\+xml)/i;

export class PageUnreadable extends Data.TaggedError("PageUnreadable")<{ url: string; reason: string }> {}

type ReadError = FetchFailed | PageUnreadable | UrlNotAllowed;

// One attempt: fetch the page under its deadline, then parse and extract. Network errors are
// retried by the caller; refused addresses and unreadable pages are not. A page over the limit is
// cut, not refused: the article is at the top and the rest is footer.
const fetchOnce = (url: string, deps: FetchDeps, allowed: Allowed): Effect.Effect<ExtractedArticle, ReadError> =>
  Effect.gen(function* () {
    const unreadable = (e: { url: string; reason: string }) => new PageUnreadable({ url: e.url, reason: e.reason });
    const body = yield* fetchBody(url, {
      allowed,
      deps,
      accept: "text/html",
      types: HTML,
      maxBytes: MAX_HTML_BYTES,
      overflow: "cut",
      timeout: TIMEOUT,
    }).pipe(Effect.catchTags({ UnexpectedType: unreadable, BodyTooLarge: unreadable }));

    const { document } = parseHTML(body.text);
    const canonical =
      document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute("href") ?? body.url;
    const published =
      document.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ??
      document.querySelector("time[datetime]")?.getAttribute("datetime") ??
      null;

    const article = new Readability(document).parse();
    if (!article?.textContent?.trim()) return yield* new PageUnreadable({ url: body.url, reason: "no readable text" });

    return {
      canonicalUrl: new URL(canonical, body.url).href,
      originalTitle: article.title?.trim() || document.title.trim(),
      extractedText: article.textContent.replace(/\s+\n/g, "\n").trim().slice(0, PROFILE.maxTextChars),
      siteName: article.siteName ?? null,
      publishedAt: published,
    };
  });

// Two retries with backoff on network errors only. Only the active sources' domains may be read,
// unless the caller names its own allowlist.
export const fetchArticle = (
  url: string,
  deps: FetchDeps = liveDeps,
  allowed: Allowed = isAllowedDomain,
): Effect.Effect<ExtractedArticle, ReadError> =>
  fetchOnce(url, deps, allowed).pipe(
    Effect.retry({
      schedule: Schedule.exponential("500 millis"),
      times: 2,
      while: (error) => error._tag === "FetchFailed",
    }),
  );

const readPageInput = z.object({ url: z.url() });
const logger = new Logger("ReadPage");

// A failure is logged here, where it is still typed: Mastra answers the caller with a generic
// error, and a refused address — the metadata service, a domain outside the sources — must leave
// its reason somewhere an operator reads.
const logged = (url: string) =>
  fetchArticle(url).pipe(
    Effect.tapError((error) =>
      Effect.sync(() =>
        logger.warn({ msg: "read_page failed", tag: error._tag, url: error.url, reason: error.reason }),
      ),
    ),
  );

export const readPage = createTool({
  id: "read_page",
  description:
    "Lê uma página de notícia de uma das fontes e devolve título, texto principal, data de publicação e URL canônica.",
  inputSchema: readPageInput,
  outputSchema: extractedArticleSchema,
  // Promise boundary: Mastra calls the tool, the effect runs here. The input is parsed again on
  // the way in: what Mastra types it as depends on its zod version, not on this schema.
  execute: (input) => Effect.runPromise(logged(readPageInput.parse(input).url)),
});
