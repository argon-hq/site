import type { LoggerService } from "@nestjs/common";
import { Data, Effect } from "effect";
import type { Allowed, FetchDeps } from "../net/fetch";
import { parseFeedDate } from "./dates";
import type { FeedError, FetchedFeed } from "./fetch-feed";
import { dedupeByUrl, groupSameFact, rank, type Candidate, type Group } from "./group";
import { scoreItem, type Signal } from "./score";
import { titleSignature } from "./signature";
import type { ActiveSource, SourceFeed } from "./source";
import type { Ficha, IngestDbFailed, IngestStore } from "./store";
import { REPUBLISH_DAYS } from "./triage";
import { canonicalize, hostInDomain, unwrapRedirect, urlHash } from "./url";

export class IngestFailed extends Data.TaggedError("IngestFailed")<{ reason: string }> {}

// A feed may run ahead of the clock by a few minutes; a date further ahead than this is a feed
// with the wrong zone, and its item is counted, not trusted.
const FUTURE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

export type IngestRun = {
  runId: string;
  now: Date;
  since: Date;
  // Only this source's domain; the others are not read. For the manual commands.
  onlySource?: string;
  // Recalibration: judge again what earlier runs already listed.
  ignoreSeen?: boolean;
  // Read and judge, write nothing: no ficha, no seen link, no source health.
  dryRun?: boolean;
  // Log every item with its decision (`ingest_debug` in the settings).
  debug?: boolean;
};

export type IngestDeps = {
  store: IngestStore;
  fetchFeed: (url: string, allowed: Allowed, deps: FetchDeps) => Effect.Effect<FetchedFeed, FeedError>;
  fetchDeps: FetchDeps;
  logger: LoggerService;
  // Addressed to the owners; never fails the run.
  alert: (reason: string) => Effect.Effect<void>;
  // Told the active sources as the run reads them: a live run refreshes the allowlist from here.
  onSources?: (sources: readonly ActiveSource[]) => void;
};

export type Decision =
  "no_date" | "out_of_window" | "future" | "bad_url" | "off_domain" | "seen" | "discarded" | "candidate";

export type ItemReport = {
  source: string;
  feed: string;
  url: string;
  title: string;
  publishedAt: string | null;
  decision: Decision;
  reason?: string;
  score?: number;
  signals?: Signal[];
};

export type FeedReport = {
  source: string;
  url: string;
  kind: SourceFeed["kind"];
  ok: boolean;
  status: number | null;
  error?: string;
  listed: number;
  inWindow: number;
  candidates: number;
  dropped: Partial<Record<Decision, number>>;
  discarded: Record<string, number>;
  durationMs: number;
};

export type GroupReport = {
  url: string;
  source: string;
  title: string;
  score: number;
  signals: Signal[];
  members: { url: string; source: string; title: string }[];
  outcome: "ficha" | "below_cutoff" | "over_cap" | "republished";
  match?: string;
};

export type IngestReport = {
  runId: string;
  date: string;
  since: string;
  dryRun: boolean;
  sources: number;
  sourcesFailed: string[];
  feeds: FeedReport[];
  listed: number;
  inWindow: number;
  candidates: number;
  groups: number;
  fichas: number;
  duplicates: number;
  belowCutoff: number;
  overCap: number;
  republished: number;
  durationMs: number;
  // The run in full, item by item and group by group: what the manual commands print and what
  // the debug layer logs. The route and the workflow keep only the counts.
  items: ItemReport[];
  groupsDetail: GroupReport[];
};

type FeedResult = { report: FeedReport; items: ItemReport[]; candidates: Candidate[]; hashes: string[] };

// Steps 0 to 4 of the chain: list every address of every active source, filter each item, score
// it, group the same fact across sources, cut, and store the fichas. No model and no page read;
// URL and date come from the feed. More sources cost network and CPU, never tokens.
export const ingest = (run: IngestRun, deps: IngestDeps): Effect.Effect<IngestReport, IngestFailed> =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    const { store, logger } = deps;
    const dbFailed = (e: IngestDbFailed) => new IngestFailed({ reason: `database: ${e.reason}` });

    // The sources are read once: a change in the middle of a run counts from the next one.
    const all = yield* store.activeSources().pipe(Effect.mapError(dbFailed));
    deps.onSources?.(all);
    const sources = run.onlySource ? all.filter((s) => s.domain === run.onlySource) : all;
    if (sources.length === 0)
      return yield* new IngestFailed({
        reason: run.onlySource ? `no active source ${run.onlySource}` : "no active source",
      });

    logger.log({
      msg: "ingest started",
      runId: run.runId,
      since: run.since.toISOString(),
      sources: sources.length,
      feeds: sources.reduce((n, s) => n + s.feeds.length, 0),
      dryRun: Boolean(run.dryRun),
    });

    // Every address at once: a slow source does not hold the others back.
    const perSource = yield* Effect.forEach(
      sources,
      (source) =>
        Effect.forEach(source.feeds, (feed) => readFeed(source, feed, run, deps), { concurrency: "unbounded" }).pipe(
          Effect.map((feeds) => ({ source, feeds })),
        ),
      { concurrency: "unbounded" },
    );
    const feedResults = perSource.flatMap((s) => s.feeds);

    // What was already listed stays out, by the hash of its canonical link.
    const allHashes = [...new Set(feedResults.flatMap((f) => f.hashes))];
    const seen = run.ignoreSeen
      ? new Set<string>()
      : yield* store
          .seen(feedResults.flatMap((f) => f.candidates.map((c) => urlHash(c.url))))
          .pipe(Effect.mapError(dbFailed));
    const items = feedResults.flatMap((f) => f.items);
    const itemOf = new Map(items.filter((i) => i.decision === "candidate").map((i) => [`${i.feed} ${i.url}`, i]));
    const fresh: Candidate[] = [];
    for (const result of feedResults) {
      for (const candidate of result.candidates) {
        if (!seen.has(urlHash(candidate.url))) {
          fresh.push(candidate);
          continue;
        }
        result.report.candidates -= 1;
        result.report.dropped.seen = (result.report.dropped.seen ?? 0) + 1;
        const item = itemOf.get(`${result.report.url} ${candidate.url}`);
        if (item) item.decision = "seen";
      }
    }

    // The same fact across sources, and against what was published or stored in the last days.
    const known = yield* store
      .known(new Date(run.now.getTime() - REPUBLISH_DAYS * 24 * 60 * 60 * 1000))
      .pipe(Effect.mapError(dbFailed));
    const groups = groupSameFact(dedupeByUrl(fresh));
    const ranked = rank(groups, known);

    const fichas = ranked.kept.map(toFicha);
    const saved = run.dryRun ? 0 : yield* store.saveFichas(fichas).pipe(Effect.mapError(dbFailed));
    // Seen only after the fichas are safe: a run that dies before storing them lists them again.
    if (!run.dryRun) yield* store.markSeen(allHashes, run.now).pipe(Effect.mapError(dbFailed));

    // Source health: one success among its addresses is a good read.
    const failed: string[] = [];
    for (const { source, feeds } of perSource) {
      const ok = feeds.some((f) => f.report.ok);
      if (!ok) failed.push(source.domain);
      if (run.dryRun) continue;
      const health = yield* store.recordSource(source.id, ok, run.now).pipe(Effect.mapError(dbFailed));
      if (health.alert) {
        const reason = `source ${source.domain} failed ${health.consecutiveFailures} runs in a row: ${feeds
          .map((f) => `${f.report.url} ${f.report.error ?? ""}`.trim())
          .join("; ")}`;
        logger.warn({
          msg: "source failing",
          runId: run.runId,
          source: source.domain,
          failures: health.consecutiveFailures,
        });
        yield* deps.alert(reason);
      }
    }

    const groupsDetail: GroupReport[] = [
      ...ranked.kept.map((g) => groupReport(g, "ficha")),
      ...ranked.overCap.map((g) => groupReport(g, "over_cap")),
      ...ranked.belowCutoff.map((g) => groupReport(g, "below_cutoff")),
      ...ranked.republished.map(({ group, match }) => ({ ...groupReport(group, "republished"), match })),
    ];

    const report: IngestReport = {
      runId: run.runId,
      date: run.now.toISOString(),
      since: run.since.toISOString(),
      dryRun: Boolean(run.dryRun),
      sources: sources.length,
      sourcesFailed: failed,
      feeds: feedResults.map((f) => f.report),
      listed: feedResults.reduce((n, f) => n + f.report.listed, 0),
      inWindow: feedResults.reduce((n, f) => n + f.report.inWindow, 0),
      candidates: fresh.length,
      groups: groups.length,
      fichas: saved,
      duplicates: run.dryRun ? 0 : fichas.length - saved,
      belowCutoff: ranked.belowCutoff.length,
      overCap: ranked.overCap.length,
      republished: ranked.republished.length,
      durationMs: Date.now() - startedAt,
      items,
      groupsDetail,
    };

    if (run.debug) {
      for (const item of items) logger.log({ msg: "ingest item", runId: run.runId, ...item });
      for (const group of groupsDetail) logger.log({ msg: "ingest group", runId: run.runId, ...group });
    }
    logger.log({ msg: "ingest finished", ...summaryOf(report) });

    // A source that fails does not stop the run; all of them failing is a run with nothing to read.
    if (failed.length === sources.length)
      return yield* new IngestFailed({ reason: `every source failed: ${failed.join(", ")}` });
    return report;
  });

// The counts, without the items: what the log line, the route and the workflow carry.
export function summaryOf(report: IngestReport) {
  return {
    runId: report.runId,
    date: report.date,
    since: report.since,
    dryRun: report.dryRun,
    sources: report.sources,
    sourcesFailed: report.sourcesFailed,
    listed: report.listed,
    inWindow: report.inWindow,
    candidates: report.candidates,
    groups: report.groups,
    fichas: report.fichas,
    duplicates: report.duplicates,
    belowCutoff: report.belowCutoff,
    overCap: report.overCap,
    republished: report.republished,
    durationMs: report.durationMs,
    feeds: report.feeds.map((f) => ({
      source: f.source,
      url: f.url,
      ok: f.ok,
      status: f.status,
      listed: f.listed,
      inWindow: f.inWindow,
      candidates: f.candidates,
      dropped: f.dropped,
      durationMs: f.durationMs,
    })),
  };
}

// One address: read, then judge every item on its own. A failure is the address's, logged and
// counted, never the run's.
const readFeed = (
  source: ActiveSource,
  feed: SourceFeed,
  run: IngestRun,
  deps: IngestDeps,
): Effect.Effect<FeedResult> =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    const allowed: Allowed = (url) => URL.canParse(url) && hostInDomain(new URL(url).hostname, source.domain);
    const report: FeedReport = {
      source: source.domain,
      url: feed.url,
      kind: feed.kind,
      ok: false,
      status: null,
      listed: 0,
      inWindow: 0,
      candidates: 0,
      dropped: {},
      discarded: {},
      durationMs: 0,
    };

    if (feed.kind === "search") {
      // Only if a chosen source has neither feed nor sitemap (ARG-123, item 9). Not built.
      report.error = "search addresses are not read by the ingestion";
      report.durationMs = Date.now() - startedAt;
      deps.logger.warn({ msg: "ingest feed skipped", runId: run.runId, ...report });
      return { report, items: [], candidates: [], hashes: [] };
    }

    const fetched = yield* Effect.either(deps.fetchFeed(feed.url, allowed, deps.fetchDeps));
    if (fetched._tag === "Left") {
      const error = fetched.left;
      report.status = "status" in error && typeof error.status === "number" ? error.status : null;
      report.error = `${error._tag}: ${error.reason}`;
      report.durationMs = Date.now() - startedAt;
      deps.logger.warn({ msg: "ingest feed failed", runId: run.runId, ...report });
      return { report, items: [], candidates: [], hashes: [] };
    }

    const parsed = fetched.right;
    report.ok = true;
    report.status = parsed.status;
    report.listed = parsed.items.length;

    const items: ItemReport[] = [];
    const candidates: Candidate[] = [];
    const hashes: string[] = [];
    const drop = (item: ItemReport, decision: Decision, reason?: string) => {
      item.decision = decision;
      if (reason) item.reason = reason;
      report.dropped[decision] = (report.dropped[decision] ?? 0) + 1;
    };

    for (const entry of parsed.items) {
      const item: ItemReport = {
        source: source.domain,
        feed: feed.url,
        url: entry.link,
        title: entry.title,
        publishedAt: null,
        decision: "candidate",
      };
      items.push(item);

      const unwrapped = unwrapRedirect(entry.link);
      if (!URL.canParse(unwrapped)) {
        drop(item, "bad_url");
        continue;
      }
      const url = canonicalize(unwrapped);
      item.url = url;
      if (!allowed(url)) {
        drop(item, "off_domain");
        continue;
      }
      hashes.push(urlHash(url));

      const publishedAt = parseFeedDate(entry.published);
      if (!publishedAt) {
        drop(item, "no_date", entry.published ?? "missing");
        continue;
      }
      item.publishedAt = publishedAt.toISOString();
      if (publishedAt < run.since) {
        drop(item, "out_of_window");
        continue;
      }
      if (publishedAt.getTime() > run.now.getTime() + FUTURE_TOLERANCE_MS) {
        drop(item, "future");
        continue;
      }
      report.inWindow += 1;

      const scored = scoreItem({
        title: entry.title,
        url: new URL(url),
        categories: entry.categories,
        trust: source.trust,
        sectionRules: source.sectionRules,
      });
      if (scored.outcome === "discarded") {
        drop(item, "discarded", scored.reason);
        const key = scored.reason;
        report.discarded[key] = (report.discarded[key] ?? 0) + 1;
        continue;
      }
      item.score = scored.score;
      item.signals = scored.signals;
      candidates.push({
        url,
        sourceId: source.id,
        sourceName: source.name,
        trust: source.trust,
        origin: parsed.format === "news_sitemap" ? "news_sitemap" : "feed",
        title: entry.title,
        publishedAt,
        text: entry.text,
        textKind: entry.textKind,
        score: scored.score,
        signals: scored.signals,
        signature: titleSignature(entry.title),
      });
    }

    report.candidates = candidates.length;
    report.durationMs = Date.now() - startedAt;
    deps.logger.log({
      msg: "ingest feed read",
      runId: run.runId,
      source: report.source,
      url: report.url,
      status: report.status,
      listed: report.listed,
      inWindow: report.inWindow,
      candidates: report.candidates,
      dropped: report.dropped,
      discarded: report.discarded,
      durationMs: report.durationMs,
    });
    return { report, items, candidates, hashes };
  });

function toFicha(group: Group): Ficha {
  const r = group.representative;
  return {
    canonicalUrl: r.url,
    sourceId: r.sourceId,
    sourceName: r.sourceName,
    title: r.title,
    publishedAt: r.publishedAt,
    origin: r.origin,
    text: r.textKind === "none" ? null : r.text,
    textKind: r.textKind,
    codeScore: group.score,
    signals: group.signals,
    sources: group.sources,
    members: group.members,
    signature: r.signature,
  };
}

function groupReport(group: Group, outcome: GroupReport["outcome"]): GroupReport {
  return {
    url: group.representative.url,
    source: group.representative.sourceName,
    title: group.representative.title,
    score: group.score,
    signals: group.signals,
    members: group.members.map((m) => ({ url: m.url, source: m.sourceName, title: m.title })),
    outcome,
  };
}
