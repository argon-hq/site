import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import { windowStart } from "../pipeline/rules";
import { fetchFeed } from "./fetch-feed";
import { fixtureDeps, fixturePublished, fixtureSources, STORIES, storyUrl } from "./fixtures";
import { ingest, summaryOf, type IngestDeps, type IngestReport, type IngestRun } from "./ingest";
import { MemoryStore } from "./memory-store";
import { FAILURES_BEFORE_ALERT } from "./store";
import { canonicalize, urlHash } from "./url";

// A Wednesday, 5h30 in São Paulo, and the Monday before it.
const WEDNESDAY = new Date("2026-09-30T08:30:00Z");
const MONDAY = new Date("2026-09-28T08:30:00Z");

const silent = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

function world(now: Date, store = new MemoryStore(fixtureSources(), fixturePublished())) {
  const alerts: string[] = [];
  const deps: IngestDeps = {
    store,
    fetchFeed,
    fetchDeps: fixtureDeps(now),
    logger: silent,
    alert: (reason) => Effect.sync(() => void alerts.push(reason)),
  };
  const run = (over: Partial<IngestRun> = {}) =>
    Effect.runPromise(ingest({ runId: "run-1", now, since: windowStart(now), ...over }, deps));
  return { store, alerts, deps, run };
}

const urlOf = (key: string, now: Date) =>
  canonicalize(
    storyUrl(
      STORIES.find((s) => s.key === key)!,
      now,
    ),
  );
const decisionOf = (report: IngestReport, key: string, now: Date) =>
  report.items.find((i) => i.url === urlOf(key, now))?.decision;

describe("ingest over the fixture", () => {
  it("stores the fichas that pass, best first, and nothing below the cutoff", async () => {
    const { store, run } = world(WEDNESDAY);
    const report = await run();

    expect(report.fichas).toBe(store.fichas.length);
    expect(report.fichas).toBeGreaterThanOrEqual(8);
    const titles = store.fichas.map((f) => f.title);
    expect(titles).toContain("Plataforma de IA para pequenas empresas automatiza cobrança");
    expect(titles).not.toContain("Juros futuros recuam com dados de inflação");
    // The Copom pair names its business effect in two outlets and leads; the credit story is next.
    expect(titles[0]).toMatch(/^Copom mantém a Selic/);
    expect(titles[1]).toBe("Crédito para pequenas empresas cresce 12% no trimestre");
    expect(titles).not.toContain("Feira de artesanato reúne expositores no fim de semana");
    expect(titles).not.toContain("Ibovespa fecha em alta de 0,8% puxado por bancos");
    expect(titles).not.toContain("Banco central da Austrália eleva juros pela segunda vez");
    const scores = store.fichas.map((f) => f.codeScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(store.fichas.every((f) => f.signals.length > 0)).toBe(true);
  });

  it("groups the same fact across outlets under the most trusted, with the others as members", async () => {
    const { store, run } = world(WEDNESDAY);
    const report = await run();

    const mei = store.fichas.find((f) => f.title.startsWith("Governo amplia limite do MEI"));
    expect(mei?.sourceName).toBe("Diário Fictício");
    expect(mei?.sources).toBe(2);
    expect(mei?.members.map((m) => m.sourceName)).toEqual(["Portal Exemplo"]);
    expect(mei?.signals).toContainEqual({ signal: "cross_coverage", points: 1 });
    // The rewritten title escapes the signature and stands on its own — and, with no lexicon of its
    // own, below the cutoff.
    const teto = report.groupsDetail.find((g) => g.title.startsWith("Teto do microempreendedor"));
    expect(teto).toMatchObject({ outcome: "below_cutoff", members: [] });
  });

  it("drops a late copy of what an edition already carried", async () => {
    const { store, run } = world(WEDNESDAY);
    const report = await run();
    expect(report.republished).toBe(1);
    expect(report.groupsDetail.find((g) => g.outcome === "republished")?.match).toBe(fixturePublished()[0]?.url);
    expect(store.fichas.some((f) => f.title.includes("lote residual"))).toBe(false);
  });

  it("drops noise by section, category and title, and says why", async () => {
    const { run } = world(WEDNESDAY);
    const report = await run();
    const reasonOf = (key: string) => report.items.find((i) => i.url === urlOf(key, WEDNESDAY))?.reason;
    expect(reasonOf("ao-vivo")).toBe("section path:/live/");
    expect(reasonOf("patrocinado")).toBe("section path:/patrocinado/");
    expect(reasonOf("opiniao")).toBe("section path:/opiniao/");
    expect(reasonOf("futebol")).toBe("section category:Esportes");
    expect(reasonOf("loteria")).toBe("noise lottery");
  });

  it("keeps the 24 h window on a weekday, to the minute, and counts what has no date", async () => {
    const { run } = world(WEDNESDAY);
    const report = await run();
    expect(decisionOf(report, "borda-dentro", WEDNESDAY)).toBe("candidate");
    expect(decisionOf(report, "borda-fora", WEDNESDAY)).toBe("out_of_window");
    expect(decisionOf(report, "fim-de-semana", WEDNESDAY)).toBe("out_of_window");
    expect(decisionOf(report, "sem-data", WEDNESDAY)).toBe("no_date");
    expect(decisionOf(report, "futuro", WEDNESDAY)).toBe("future");
    expect(report.feeds.find((f) => f.source === "revista-modelo.test")?.dropped.no_date).toBe(1);
    expect(report.feeds.find((f) => f.source === "portal-exemplo.test")?.dropped.future).toBe(1);
  });

  it("opens 48 h on a Monday", async () => {
    const { store, run } = world(MONDAY);
    const report = await run();
    expect(decisionOf(report, "borda-fora", MONDAY)).toBe("candidate");
    expect(store.fichas.some((f) => f.title.startsWith("Varejista fictícia anuncia demissões"))).toBe(true);
  });

  it("reads a date without offset as São Paulo time", async () => {
    const { store, run } = world(WEDNESDAY);
    await run();
    const aporte = store.fichas.find((f) => f.title.startsWith("Startup de logística"));
    expect(aporte?.publishedAt.toISOString()).toBe(new Date(WEDNESDAY.getTime() - 12 * 3_600_000).toISOString());
  });

  it("reads the ISO-8859-1 feed with its accents and unwraps the redirector", async () => {
    const { store, run } = world(WEDNESDAY);
    const report = await run();
    const agencia = report.items.filter((i) => i.source === "agencia-inventada.test");
    expect(agencia.map((i) => i.title)).toContain("Regulamentação da reforma tributária entra em consulta pública");
    expect(agencia.every((i) => i.url.startsWith("https://agencia-inventada.test/economia/"))).toBe(true);
    expect(store.fichas.find((f) => f.title.startsWith("Regulamentação"))?.canonicalUrl).toBe(
      urlOf("tributaria", WEDNESDAY),
    );
  });

  it("strips tracking parameters and keeps the feed's text with its kind", async () => {
    const { store, run } = world(WEDNESDAY);
    await run();
    const credito = store.fichas.find((f) => f.title.startsWith("Crédito para pequenas"));
    expect(credito?.canonicalUrl).toBe(urlOf("credito", WEDNESDAY));
    expect(credito?.canonicalUrl).not.toContain("utm_");
    expect(credito?.textKind).toBe("full");
    expect(store.fichas.find((f) => f.title.startsWith("Rede fictícia"))?.textKind).toBe("none");
    expect(store.fichas.find((f) => f.title.startsWith("Startup de logística"))?.textKind).toBe("summary");
  });

  it("counts a malformed feed and a source down as failures of the address, and goes on", async () => {
    const { run } = world(WEDNESDAY);
    const report = await run();
    const broken = report.feeds.find((f) => f.url.endsWith("/quebrado.xml"));
    expect(broken).toMatchObject({ ok: false });
    expect(broken?.error).toMatch(/^FeedMalformed/);
    expect(report.feeds.find((f) => f.source === "fonte-fora-do-ar.test")).toMatchObject({ ok: false, status: 503 });
    // The Diário has one address that read: the source is fine.
    expect(report.sourcesFailed).toEqual(["fonte-fora-do-ar.test"]);
  });

  it("marks every listed link as seen, by hash, and does not store a ficha twice on a second run", async () => {
    const { store, run } = world(WEDNESDAY);
    const first = await run();
    expect(store.seenHashes.has(urlHash(urlOf("borda-fora", WEDNESDAY)))).toBe(true);
    expect(store.seenHashes.has(urlHash(urlOf("ao-vivo", WEDNESDAY)))).toBe(true);

    const second = await run();
    expect(second.fichas).toBe(0);
    expect(second.candidates).toBe(0);
    expect(store.fichas).toHaveLength(first.fichas);
  });

  it("judges again with ignoreSeen, and still does not double a ficha", async () => {
    const { store, run } = world(WEDNESDAY);
    const first = await run();
    const again = await run({ ignoreSeen: true });
    expect(again.candidates).toBeGreaterThan(0);
    // Today's fichas are known now: the same facts come back as late copies, not as new rows.
    expect(store.fichas).toHaveLength(first.fichas);
  });

  it("writes nothing on a dry run", async () => {
    const { store, run } = world(WEDNESDAY);
    const report = await run({ dryRun: true });
    expect(report.groupsDetail.filter((g) => g.outcome === "ficha").length).toBeGreaterThan(0);
    expect(report.fichas).toBe(0);
    expect(store.fichas).toHaveLength(0);
    expect(store.seenHashes.size).toBe(0);
    expect(store.health.size).toBe(0);
  });

  it("reads one source only when asked", async () => {
    const { run } = world(WEDNESDAY);
    const report = await run({ onlySource: "portal-exemplo.test" });
    expect(report.sources).toBe(1);
    expect(new Set(report.items.map((i) => i.source))).toEqual(new Set(["portal-exemplo.test"]));
  });

  it("logs every item and group only in debug", async () => {
    const quiet = world(WEDNESDAY);
    silent.log.mockClear();
    await quiet.run();
    expect(silent.log.mock.calls.some(([line]) => (line as { msg: string }).msg === "ingest item")).toBe(false);
    await world(WEDNESDAY).run({ debug: true });
    const items = silent.log.mock.calls.filter(([line]) => (line as { msg: string }).msg === "ingest item");
    expect(items.length).toBeGreaterThan(10);
    expect(items[0]?.[0]).toMatchObject({ runId: "run-1" });
  });

  it("alerts the owners once when a source fails three runs in a row, and a good read resets it", async () => {
    const { store, alerts, run } = world(WEDNESDAY);
    for (let i = 0; i < FAILURES_BEFORE_ALERT + 2; i++) await run({ ignoreSeen: true });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/fonte-fora-do-ar\.test failed 3 runs in a row/);
    expect(store.health.get("fixture-offline")?.failures).toBe(FAILURES_BEFORE_ALERT + 2);
    expect(store.health.get("fixture-diario")).toMatchObject({ failures: 0, lastOk: WEDNESDAY });
    // A 503 is retried once, a second apart: five runs take a few seconds.
  }, 20_000);

  it("fails the step and names every source when all of them fail", async () => {
    const down = fixtureSources().filter((s) => s.domain === "fonte-fora-do-ar.test");
    const { deps } = world(WEDNESDAY, new MemoryStore(down));
    const exit = await Effect.runPromiseExit(
      ingest({ runId: "r", now: WEDNESDAY, since: windowStart(WEDNESDAY) }, deps),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("every source failed: fonte-fora-do-ar.test");
  });

  it("fails when there is no active source to read", async () => {
    const { deps } = world(WEDNESDAY, new MemoryStore([]));
    const exit = await Effect.runPromiseExit(
      ingest({ runId: "r", now: WEDNESDAY, since: windowStart(WEDNESDAY) }, deps),
    );
    expect(JSON.stringify(exit)).toContain("no active source");
  });

  it("tells the caller the sources it read, for the allowlist", async () => {
    const seen: string[] = [];
    const { deps } = world(WEDNESDAY);
    await Effect.runPromise(
      ingest(
        { runId: "r", now: WEDNESDAY, since: windowStart(WEDNESDAY) },
        { ...deps, onSources: (sources) => seen.push(...sources.map((s) => s.domain)) },
      ),
    );
    expect(seen).toContain("diario-ficticio.test");
  });

  it("summarizes without the items, for the log line and the route", async () => {
    const report = await world(WEDNESDAY).run();
    const summary = summaryOf(report);
    expect(summary).not.toHaveProperty("items");
    expect(summary).not.toHaveProperty("groupsDetail");
    expect(summary.feeds[0]).toHaveProperty("listed");
  });
});
