import { Effect, Schedule } from "effect";
import { fetchBody, type Allowed, type BodyError, type FetchDeps } from "../net/fetch";
import { FeedMalformed, parseFeed, type ParsedFeed } from "./parse";

// A news sitemap of two days runs to ~700 KB; this leaves room without letting a runaway address in.
export const MAX_FEED_BYTES = 5_000_000;
const ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1";
const TIMEOUT = "15 seconds";

export type FetchedFeed = ParsedFeed & { url: string; status: number; bytes: number; charset: string };
export type FeedError = BodyError | FeedMalformed;

// One address, read once: the body in the charset it declares, parsed. No page is opened here — URL
// and date come from the feed. A body over the limit fails instead of being cut: a cut XML is a
// broken one.
const fetchOnce = (url: string, allowed: Allowed, deps: FetchDeps): Effect.Effect<FetchedFeed, FeedError> =>
  fetchBody(url, { allowed, deps, accept: ACCEPT, maxBytes: MAX_FEED_BYTES, overflow: "fail", timeout: TIMEOUT }).pipe(
    Effect.flatMap((body) =>
      Effect.try({
        try: () => ({
          ...parseFeed(body.text),
          url: body.url,
          status: body.status,
          bytes: body.bytes,
          charset: body.charset,
        }),
        catch: (error) => (error instanceof FeedMalformed ? error : new FeedMalformed({ reason: String(error) })),
      }),
    ),
  );

// A failure the next attempt may not repeat: the network, or the server itself (5xx). A refusal
// (4xx), a blocked address, a body too large or a malformed feed would answer the same.
const isTransient = (error: FeedError): boolean =>
  error._tag === "FetchFailed" && (error.status === undefined || error.status >= 500);

export const fetchFeed = (url: string, allowed: Allowed, deps: FetchDeps): Effect.Effect<FetchedFeed, FeedError> =>
  fetchOnce(url, allowed, deps).pipe(
    Effect.retry({ schedule: Schedule.exponential("1 second"), times: 1, while: isTransient }),
  );
