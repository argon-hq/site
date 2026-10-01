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
  private readonly links = new Set<string>();

  constructor(
    private readonly sources: readonly ActiveSource[],
    private readonly published: readonly Known[] = [],
  ) {}

  activeSources() {
    return Effect.succeed([...this.sources]);
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
  known(): Effect.Effect<Known[]> {
    return Effect.succeed([
      ...this.published,
      ...this.fichas.map((ficha) => ({ url: ficha.canonicalUrl, signature: ficha.signature })),
    ]);
  }

  // One ficha per link: a second with the same link is not an error, it is not saved.
  saveFichas(fichas: readonly Ficha[]) {
    return Effect.sync(() => {
      const fresh = fichas.filter((ficha) => !this.links.has(ficha.canonicalUrl));
      for (const ficha of fresh) {
        this.links.add(ficha.canonicalUrl);
        this.fichas.push(ficha);
      }
      return fresh.length;
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
