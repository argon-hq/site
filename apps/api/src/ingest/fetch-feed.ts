import { Effect, Schedule } from "effect";
import { fetchBody, type Allowed, type BodyError, type FetchDeps } from "../net/fetch";
import { FeedMalformed, parseFeed, type ParsedFeed } from "./parse";

// A news sitemap of two days runs to ~700 KB; this leaves room without letting a runaway address in.
export const MAX_FEED_BYTES = 5_000_000;
const ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1";

export type FetchedFeed = ParsedFeed & { status: number; bytes: number; charset: string };
export type FeedError = BodyError | { _tag: "FeedMalformed"; url: string; reason: string; status: number };

// One address, read once: the body in the charset it declares, parsed. No page is opened here — URL
// and date come from the feed. A body over the limit fails instead of being cut: a cut XML is a
// broken one.
const fetchOnce = (url: string, allowed: Allowed, deps: FetchDeps): Effect.Effect<FetchedFeed, FeedError> =>
  fetchBody(url, {
    allowed,
    deps,
    accept: ACCEPT,
    maxBytes: MAX_FEED_BYTES,
    overflow: "fail",
    timeout: "15 seconds",
  }).pipe(
    Effect.flatMap((body) =>
      Effect.try({
        try: () => ({ ...parseFeed(body.text), status: body.status, bytes: body.bytes, charset: body.charset }),
        catch: (error) => ({
          _tag: "FeedMalformed" as const,
          url: body.url,
          reason: error instanceof FeedMalformed ? error.message : String(error),
          status: body.status,
        }),
      }),
    ),
  );

// One retry on network and server errors; a refusal (4xx), a blocked address, a body too large or a
// malformed feed is not retried — it would answer the same.
export const fetchFeed = (url: string, allowed: Allowed, deps: FetchDeps): Effect.Effect<FetchedFeed, FeedError> =>
  fetchOnce(url, allowed, deps).pipe(
    Effect.retry({
      schedule: Schedule.exponential("1 second"),
      times: 1,
      while: (e) => e._tag === "FetchFailed" && (e.status === undefined || e.status >= 500),
    }),
  );
