import { Effect } from "effect";
import type { ActiveSource } from "./source";
import { FAILURES_BEFORE_ALERT, type Ficha, type IngestStore, type Known } from "./store";

// The store in memory: what the tests and the dry runs of the manual commands work against. It
// behaves like the database where the ingestion can tell — unique links, seen hashes, one alert per
// streak of failures — and keeps everything in plain fields for a test to read.
export class MemoryStore implements IngestStore {
  readonly fichas: Ficha[] = [];
  readonly seenHashes = new Map<string, Date>();
  readonly health = new Map<string, { failures: number; alerted: boolean; lastOk: Date | null }>();

  constructor(
    private readonly sources: ActiveSource[],
    private readonly published: Known[] = [],
  ) {}

  activeSources() {
    return Effect.succeed(this.sources);
  }

  seen(hashes: readonly string[]) {
    return Effect.succeed(new Set(hashes.filter((h) => this.seenHashes.has(h))));
  }

  markSeen(hashes: readonly string[], at: Date) {
    return Effect.sync(() => {
      for (const hash of hashes) this.seenHashes.set(hash, at);
    });
  }

  // Everything it holds is recent: a test runs in one day.
  known() {
    return Effect.succeed([
      ...this.published,
      ...this.fichas.map((f) => ({ url: f.canonicalUrl, signature: f.signature })),
    ]);
  }

  saveFichas(fichas: readonly Ficha[]) {
    return Effect.sync(() => {
      let saved = 0;
      for (const ficha of fichas) {
        if (this.fichas.some((f) => f.canonicalUrl === ficha.canonicalUrl)) continue;
        this.fichas.push(ficha);
        saved += 1;
      }
      return saved;
    });
  }

  recordSource(sourceId: string, ok: boolean, at: Date) {
    return Effect.sync(() => {
      const held = this.health.get(sourceId) ?? { failures: 0, alerted: false, lastOk: null };
      if (ok) {
        this.health.set(sourceId, { failures: 0, alerted: false, lastOk: at });
        return { consecutiveFailures: 0, alert: false };
      }
      const failures = held.failures + 1;
      const alert = failures >= FAILURES_BEFORE_ALERT && !held.alerted;
      this.health.set(sourceId, { failures, alerted: held.alerted || alert, lastOk: held.lastOk });
      return { consecutiveFailures: failures, alert };
    });
  }
}
