import { createTool } from "@mastra/core/tools";
import { Readability } from "@mozilla/readability";
import { Data, Effect, Schedule } from "effect";
import { parseHTML } from "linkedom";
import { z } from "zod";
import { MAX_TEXT_CHARS } from "../../pipeline/rules";
import { extractedArticleSchema, type ExtractedArticle } from "../schemas/article";

// Hard rules live here, not in the prompt.
const TIMEOUT = "10 seconds";
const MAX_HTML_BYTES = 2_000_000;
const USER_AGENT = "ArgonNewsletterBot/0.1 (+https://argon.com.br)";

export class FetchFailed extends Data.TaggedError("FetchFailed")<{ url: string; reason: string }> {}
export class PageUnreadable extends Data.TaggedError("PageUnreadable")<{ url: string; reason: string }> {}

// One attempt: fetch, parse, extract. Network errors are retried by the caller; unreadable pages are not.
const fetchOnce = (url: string): Effect.Effect<ExtractedArticle, FetchFailed | PageUnreadable> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) => fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" }, signal, redirect: "follow" }),
      catch: (error) => new FetchFailed({ url, reason: String(error) }),
    });
    if (!response.ok) return yield* new FetchFailed({ url, reason: `HTTP ${response.status}` });

    const html = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (error) => new FetchFailed({ url, reason: String(error) }),
    });
    const { document } = parseHTML(html.slice(0, MAX_HTML_BYTES));
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute("href") ?? response.url;
    const published =
      document.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ??
      document.querySelector("time[datetime]")?.getAttribute("datetime") ??
      null;

    const article = new Readability(document as unknown as Document).parse();
    if (!article?.textContent?.trim()) return yield* new PageUnreadable({ url, reason: "no readable text" });

    return {
      canonicalUrl: new URL(canonical, response.url).toString(),
      originalTitle: article.title?.trim() || document.title.trim(),
      extractedText: article.textContent.replace(/\s+\n/g, "\n").trim().slice(0, MAX_TEXT_CHARS),
      siteName: article.siteName ?? null,
      publishedAt: published,
    };
  });

// Timeout per attempt, two retries with backoff on network errors only.
export const fetchArticle = (url: string) =>
  fetchOnce(url).pipe(
    Effect.timeoutFail({ duration: TIMEOUT, onTimeout: () => new FetchFailed({ url, reason: "timeout" }) }),
    Effect.retry({ schedule: Schedule.exponential("500 millis"), times: 2, while: (error) => error._tag === "FetchFailed" }),
  );

export const readPage = createTool({
  id: "read_page",
  description: "Lê uma página de notícia e devolve título, texto principal, data de publicação e URL canônica.",
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: extractedArticleSchema,
  // Promise boundary: Mastra calls the tool, the effect runs here.
  execute: ({ url }) => Effect.runPromise(fetchArticle(url)),
});
