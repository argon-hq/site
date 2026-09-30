import { Effect, Schedule } from "effect";
import {
  charsetOf,
  decode,
  fetchGuarded,
  FetchFailed,
  readBytes,
  type Allowed,
  type FetchDeps,
  type UrlNotAllowed,
} from "../net/fetch";
import { FeedMalformed, parseFeed, type ParsedFeed } from "./parse";

const TIMEOUT = "15 seconds";
// A news sitemap of two days runs to ~700 KB; this leaves room without letting a runaway address in.
export const MAX_FEED_BYTES = 5_000_000;
const ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1";

export type FetchedFeed = ParsedFeed & { status: number; bytes: number; charset: string };
export type FeedError =
  FetchFailed | UrlNotAllowed | { _tag: "FeedMalformed"; url: string; reason: string; status: number };

// One address, read once: fetch in the charset it declares, parse, hand back the items. No page is
// opened here — URL and date come from the feed.
const fetchOnce = (url: string, allowed: Allowed, deps: FetchDeps): Effect.Effect<FetchedFeed, FeedError> =>
  Effect.gen(function* () {
    const controller = new AbortController();
    const { response, url: finalUrl } = yield* fetchGuarded(url, {
      allowed,
      deps,
      accept: ACCEPT,
      signal: controller.signal,
    }).pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())));
    if (!response.ok) {
      yield* Effect.promise(() => response.body?.cancel() ?? Promise.resolve());
      return yield* new FetchFailed({ url: finalUrl, reason: `HTTP ${response.status}`, status: response.status });
    }
    const bytes = yield* readBytes(response, finalUrl, MAX_FEED_BYTES);
    const charset = charsetOf(response.headers.get("content-type"), bytes);
    const parsed = yield* Effect.try({
      try: () => parseFeed(decode(bytes, charset)),
      catch: (error) => ({
        _tag: "FeedMalformed" as const,
        url: finalUrl,
        reason: error instanceof FeedMalformed ? error.message : String(error),
        status: response.status,
      }),
    });
    return { ...parsed, status: response.status, bytes: bytes.byteLength, charset };
  });

// Timeout per attempt and one retry on network and server errors; a refusal (4xx), a blocked
// address or a malformed feed is not retried — it would answer the same.
export const fetchFeed = (url: string, allowed: Allowed, deps: FetchDeps): Effect.Effect<FetchedFeed, FeedError> =>
  fetchOnce(url, allowed, deps).pipe(
    Effect.timeoutFail({ duration: TIMEOUT, onTimeout: () => new FetchFailed({ url, reason: "timeout" }) }),
    Effect.retry({
      schedule: Schedule.exponential("1 second"),
      times: 1,
      while: (e) => e._tag === "FetchFailed" && (e.status === undefined || e.status >= 500),
    }),
  );
