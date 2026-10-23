import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { titleSignature } from "./signature";
import { FAILURES_BEFORE_ALERT, type Ficha, type IngestStore } from "./store";

const ficha = (canonicalUrl: string, title = "Copom mantém a Selic"): Ficha => ({
  canonicalUrl,
  sourceId: "s1",
  sourceName: "Fonte",
  title,
  publishedAt: new Date("2026-09-30T08:00:00Z"),
  origin: "feed",
  text: null,
  textKind: "none",
  codeScore: 4,
  signals: [],
  sources: 1,
  members: [],
  signature: titleSignature(title),
});

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

describe("MemoryStore", () => {
  it("remembers the hashes it marked, and only those", async () => {
    const store = new MemoryStore([]);
    await run(store.markSeen(["a", "b"], new Date()));
    expect(await run(store.seen(["a", "c"]))).toEqual(new Set(["a"]));
  });

  it("saves one ficha per link and counts only the new ones", async () => {
    const store = new MemoryStore([]);
    expect(await run(store.saveFichas([ficha("https://x.test/a"), ficha("https://x.test/b")]))).toBe(2);
    expect(await run(store.saveFichas([ficha("https://x.test/a"), ficha("https://x.test/c")]))).toBe(1);
    expect(store.fichas.map((f) => f.canonicalUrl)).toEqual([
      "https://x.test/a",
      "https://x.test/b",
      "https://x.test/c",
    ]);
  });

  it("knows what was published before and what it stored since", async () => {
    const published = { url: "https://old.test/p", signature: titleSignature("Receita libera lote") };
    const store: IngestStore = new MemoryStore([], [published]);
    await run(store.saveFichas([ficha("https://x.test/a")]));
    expect((await run(store.known(new Date()))).map((k) => k.url)).toEqual(["https://old.test/p", "https://x.test/a"]);
  });

  it("alerts once when a source fails enough runs in a row, and a good read resets the streak", async () => {
    const store = new MemoryStore([]);
    const at = new Date();
    const results = [];
    for (let i = 0; i < FAILURES_BEFORE_ALERT + 1; i++) results.push(await run(store.recordSource("s1", false, at)));
    expect(results.map((r) => r.alert)).toEqual([false, false, true, false]);
    expect(results.at(-1)?.consecutiveFailures).toBe(FAILURES_BEFORE_ALERT + 1);
    expect(await run(store.recordSource("s1", true, at))).toEqual({ consecutiveFailures: 0, alert: false });
    expect((await run(store.recordSource("s1", false, at))).consecutiveFailures).toBe(1);
  });
});
