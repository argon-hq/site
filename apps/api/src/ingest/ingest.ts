import type { LoggerService } from "@nestjs/common";
import { Data, Effect, Struct } from "effect";
import type { Allowed, FetchDeps } from "../net/fetch";
import { parseFeedDate } from "./dates";
import type { FeedError, FetchedFeed } from "./fetch-feed";
import { dedupeByUrl, groupSameFact, rank, type Candidate, type Group } from "./group";
import {
  groupReport,
  summaryOf,
  type Decision,
  type FeedReport,
  type GroupReport,
  type IngestReport,
  type ItemReport,
} from "./report";
import { scoreItem } from "./score";
import { titleSignature } from "./signature";
import type { ActiveSource, SourceFeed } from "./source";
import type { Ficha, IngestDbFailed, IngestStore } from "./store";
import { REPUBLISH_DAYS } from "./triage";
import { canonicalize, hostInDomain, unwrapRedirect, urlHash } from "./url";

export type { Decision, FeedReport, GroupReport, IngestReport, IngestSummary, ItemReport } from "./report";
export { summaryOf } from "./report";

export class IngestFailed extends Data.TaggedError("IngestFailed")<{ reason: string }> {}

// A feed may run ahead of the clock by a few minutes; a date further ahead than this is a feed
// with the wrong zone, and its item is counted, not trusted.
const FUTURE_TOLERANCE_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// How many addresses are read at once: every source of the survey together, and a table that grows
// to many more sources still does not open a socket per address.
const FEED_CONCURRENCY = 8;

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
  // Log every item with its decision.
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

// One address, read and judged: its report, every item with its decision, the candidates that
// passed and the hash of every link it listed.
type FeedResult = {
  source: ActiveSource;
  report: FeedReport;
  items: ItemReport[];
  candidates: Candidate[];
  hashes: string[];
};

// Steps 0 to 4 of the chain: list every address of every active source, filter each item, score
// it, group the same fact across sources, cut, and store the fichas. No model and no page read;
// URL and date come from the feed. More sources cost network and CPU, never tokens.
export const ingest = (run: IngestRun, deps: IngestDeps): Effect.Effect<IngestReport, IngestFailed> =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    const { store, logger } = deps;
    const fromStore = <A>(effect: Effect.Effect<A, IngestDbFailed>) =>
      effect.pipe(Effect.mapError((e) => new IngestFailed({ reason: `database: ${e.reason}` })));

    // The sources are read once: a change in the middle of a run counts from the next one.
    const all = yield* fromStore(store.activeSources());
    deps.onSources?.(all);
    const sources = run.onlySource ? all.filter((source) => source.domain === run.onlySource) : all;
    if (sources.length === 0) {
      return yield* new IngestFailed({
        reason: run.onlySource ? `no active source ${run.onlySource}` : "no active source",
      });
    }

    const addresses = sources.flatMap((source) => source.feeds.map((feed) => ({ source, feed })));
    logger.log({
      msg: "ingest started",
      runId: run.runId,
      since: run.since.toISOString(),
      sources: sources.length,
      feeds: addresses.length,
      dryRun: Boolean(run.dryRun),
    });

    // Every address together, up to the limit: a slow source does not hold the others back.
    const results = yield* Effect.forEach(addresses, ({ source, feed }) => readFeed(source, feed, run, deps), {
      concurrency: FEED_CONCURRENCY,
    });

    // What was already listed stays out, by the hash of its canonical link.
    const seen = run.ignoreSeen
      ? new Set<string>()
      : yield* fromStore(store.seen(results.flatMap((result) => result.candidates.map((c) => urlHash(c.url)))));
    const fresh = results.flatMap((result) => withoutSeen(result, seen));

    // The same fact across sources, and against what was published or stored in the last days.
    const known = yield* fromStore(store.known(new Date(run.now.getTime() - REPUBLISH_DAYS * DAY_MS)));
    const groups = groupSameFact(dedupeByUrl(fresh));
    const ranked = rank(groups, known);

    const fichas = ranked.kept.map(toFicha);
    const saved = run.dryRun ? 0 : yield* fromStore(store.saveFichas(fichas));
    // Seen only after the fichas are safe: a run that dies before storing them lists them again.
    const listed = [...new Set(results.flatMap((result) => result.hashes))];
    if (!run.dryRun) yield* fromStore(store.markSeen(listed, run.now));

    // Source health: one success among its addresses is a good read.
    const failed: string[] = [];
    for (const source of sources) {
      const own = results.filter((result) => result.source === source);
      const ok = own.some((result) => result.report.ok);
      if (!ok) failed.push(source.domain);
      if (run.dryRun) continue;
      const health = yield* fromStore(store.recordSource(source.id, ok, run.now));
      if (!health.alert) continue;
      logger.warn({
        msg: "source failing",
        runId: run.runId,
        source: source.domain,
        failures: health.consecutiveFailures,
      });
      const errors = own.map((result) => `${result.report.url} ${result.report.error ?? ""}`.trim()).join("; ");
      yield* deps.alert(`source ${source.domain} failed ${health.consecutiveFailures} runs in a row: ${errors}`);
    }

    const items = results.flatMap((result) => result.items);
    const groupsDetail: GroupReport[] = [
      ...ranked.kept.map((group) => groupReport(group, "ficha")),
      ...ranked.overCap.map((group) => groupReport(group, "over_cap")),
      ...ranked.belowCutoff.map((group) => groupReport(group, "below_cutoff")),
      ...ranked.republished.map(({ group, match }) => ({ ...groupReport(group, "republished"), match })),
    ];
    const report: IngestReport = {
      runId: run.runId,
      date: run.now.toISOString(),
      since: run.since.toISOString(),
      dryRun: Boolean(run.dryRun),
      sources: sources.length,
      sourcesFailed: failed,
      feeds: results.map((result) => result.report),
      listed: sum(results, (result) => result.report.listed),
      inWindow: sum(results, (result) => result.report.inWindow),
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
    if (failed.length === sources.length) {
      return yield* new IngestFailed({ reason: `every source failed: ${failed.join(", ")}` });
    }
    return report;
  });

const sum = <T>(list: readonly T[], of: (item: T) => number) => list.reduce((total, item) => total + of(item), 0);

// The candidates of one address that no earlier run listed. The ones already seen leave the
// address's counts and keep their decision in the item report.
function withoutSeen(result: FeedResult, seen: ReadonlySet<string>): Candidate[] {
  const fresh: Candidate[] = [];
  for (const candidate of result.candidates) {
    if (!seen.has(urlHash(candidate.url))) {
      fresh.push(candidate);
      continue;
    }
    result.report.candidates -= 1;
    result.report.dropped.seen = (result.report.dropped.seen ?? 0) + 1;
    const item = result.items.find((entry) => entry.decision === "candidate" && entry.url === candidate.url);
    if (item) item.decision = "seen";
  }
  return fresh;
}

const emptyReport = (source: ActiveSource, feed: SourceFeed): FeedReport => ({
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
});

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
    const allowed: Allowed = (url) => hostInDomain(url.hostname, source.domain);
    const report = emptyReport(source, feed);
    const nothing = (error: string, msg: string): FeedResult => {
      report.error = error;
      report.durationMs = Date.now() - startedAt;
      deps.logger.warn({ msg, runId: run.runId, ...report });
      return { source, report, items: [], candidates: [], hashes: [] };
    };

    // Only if a chosen source has neither feed nor sitemap (ARG-123, item 9). Not built.
    if (feed.kind === "search") return nothing("search addresses are not read by the ingestion", "ingest feed skipped");

    const fetched = yield* Effect.either(deps.fetchFeed(feed.url, allowed, deps.fetchDeps));
    if (fetched._tag === "Left") {
      const error = fetched.left;
      report.status = error._tag === "FetchFailed" ? (error.status ?? null) : null;
      return nothing(`${error._tag}: ${error.reason}`, "ingest feed failed");
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
      if (!allowed(new URL(url))) {
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
        report.discarded[scored.reason] = (report.discarded[scored.reason] ?? 0) + 1;
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
    deps.logger.log({ msg: "ingest feed read", runId: run.runId, ...Struct.omit(report, "kind", "error") });
    return { source, report, items, candidates, hashes };
  });

function toFicha(group: Group): Ficha {
  const { representative: r } = group;
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
