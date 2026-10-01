import { Data, Effect } from "effect";
import type { Known, Member } from "./group";
import type { TextKind } from "./parse";
import type { Signal } from "./score";
import type { ActiveSource, FeedKind } from "./source";

export type { Known } from "./group";

export class IngestDbFailed extends Data.TaggedError("IngestDbFailed")<{ reason: string }> {}

// What one ingestion stores of a group: the ficha. Identity and decision, and the feed's text —
// the one thing that cannot be fetched again once the feed moves on.
export type Ficha = {
  canonicalUrl: string;
  sourceId: string | null; // null only for the mocked sources, which have no row
  sourceName: string;
  title: string;
  publishedAt: Date;
  origin: FeedKind;
  text: string | null;
  textKind: TextKind;
  codeScore: number;
  signals: Signal[];
  sources: number;
  members: Member[];
  signature: number[];
};

export type SourceHealth = { consecutiveFailures: number; alert: boolean };

// The database as an ingestion sees it. An interface: for now only the memory store implements it,
// for the tests and the manual commands; the next step adds the one over Prisma. `known` answers
// what was published or stored since a date, the other side of a late copy.
export type IngestStore = {
  activeSources(): Effect.Effect<ActiveSource[], IngestDbFailed>;
  seen(hashes: readonly string[]): Effect.Effect<Set<string>, IngestDbFailed>;
  markSeen(hashes: readonly string[], at: Date): Effect.Effect<void, IngestDbFailed>;
  known(since: Date): Effect.Effect<Known[], IngestDbFailed>;
  saveFichas(fichas: readonly Ficha[]): Effect.Effect<number, IngestDbFailed>;
  recordSource(sourceId: string, ok: boolean, at: Date): Effect.Effect<SourceHealth, IngestDbFailed>;
};

// After this many runs in a row with every address of a source failing, the owners hear of it —
// once, until a read succeeds again. The source stays active: a feed down for a morning is not a
// decision to drop it.
export const FAILURES_BEFORE_ALERT = 3;

// The longest text kept of a feed. Enough for any article; a runaway `content:encoded` is cut.
export const MAX_FEED_TEXT_CHARS = 12_000;
