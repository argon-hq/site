// Manual commands for the ingestion: look at the sources, read one address or one page, and run the
// whole ingestion — over the real feeds or the fixture — item by item, to calibrate the triage.
//
//   pnpm ingest:sources            the sources of DATABASE_URL, with their addresses and health
//   pnpm ingest:feed <url>         one address: every item, its date, window, score or discard reason
//   pnpm ingest:page <url>         one page: what the extraction gets out of it
//   pnpm ingest:run                the ingestion, writing fichas and seen links
//
// `--json` prints the raw result; `--date <ISO>` moves the window. `run` also takes `--mock` (the
// fixture's invented sources, no network), `--source <domain>`, `--report <file>`, `--dry-run`
// (write nothing: no ficha, no seen link, no source health) and `--ignore-seen` (judge again what
// earlier runs already listed, to recalibrate). `--mock --dry-run` needs no database.
//
// Wires the pieces by hand instead of booting Nest: the commands need the database and the network,
// not the HTTP layer, the agents or the guard.

import "dotenv/config";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseFeedDate } from "../src/ingest/dates";
import { fetchFeed } from "../src/ingest/fetch-feed";
import { fixtureDeps, fixturePublished, fixtureSources } from "../src/ingest/fixtures";
import { ingest, summaryOf, type IngestReport, type ItemReport } from "../src/ingest/ingest";
import { MemoryStore } from "../src/ingest/memory-store";
import { ingestWorld } from "../src/ingest/mode";
import { scoreItem } from "../src/ingest/score";
import type { ActiveSource } from "../src/ingest/source";
import { prismaIngestStore, type IngestStore } from "../src/ingest/store";
import { canonicalize, hostInDomain, unwrapRedirect } from "../src/ingest/url";
import { fetchArticle } from "../src/mastra/tools/read-page";
import { liveDeps, type Allowed } from "../src/net/fetch";
import { windowStart } from "../src/pipeline/rules";
import { PrismaService } from "../src/prisma/prisma.service";

const USAGE =
  "usage: ingest sources | feed <url> [--date ISO] | page <url> | run [--mock] [--source d] [--date ISO] [--report file] [--dry-run] [--ignore-seen]   [--json]";

type Flags = {
  json: boolean;
  date?: string;
  mock: boolean;
  source?: string;
  report?: string;
  dryRun: boolean;
  ignoreSeen: boolean;
};

function database(): PrismaService {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (apps/api/.env)");
  return new PrismaService(url);
}

// The active sources of the database, read the way a run reads them; empty without DATABASE_URL.
async function activeSources(): Promise<ActiveSource[]> {
  if (!process.env.DATABASE_URL) return [];
  const prisma = database();
  try {
    return await Effect.runPromise(prismaIngestStore(prisma).activeSources());
  } finally {
    await prisma.$disconnect();
  }
}

const sourceOf = (url: string, sources: readonly ActiveSource[]) =>
  URL.canParse(url) ? (sources.find((source) => hostInDomain(new URL(url).hostname, source.domain)) ?? null) : null;
type Row = Record<string, unknown>;

// A table that fits a terminal: columns padded to the widest cell, long ones cut.
function table(rows: readonly Row[], widths: Record<string, number> = {}): string {
  const [first] = rows;
  if (!first) return "(none)";
  const cell = (key: string, value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    const max = widths[key] ?? 60;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const columns = Object.keys(first).map((key) => ({
    key,
    width: Math.max(key.length, ...rows.map((row) => cell(key, row[key]).length)),
  }));
  const line = (cells: readonly string[]) => columns.map(({ width }, i) => (cells[i] ?? "").padEnd(width)).join("  ");
  return [
    line(columns.map(({ key }) => key)),
    line(columns.map(({ width }) => "-".repeat(width))),
    ...rows.map((row) => line(columns.map(({ key }) => cell(key, row[key])))),
  ].join("\n");
}

const print = (flags: Flags, value: unknown, human: () => string) =>
  console.log(flags.json ? JSON.stringify(value, null, 2) : human());

// Only the source's own domain and its subdomains may be read, as in a run: a canonical link has no
// `www.`, and the site may well redirect to it.
function allowedFor(url: string, source: ActiveSource | null): Allowed {
  const domain = source?.domain ?? new URL(url).hostname.replace(/^www\./, "");
  return (target) => hostInDomain(target.hostname, domain);
}

// Runs the effect; a failure is printed with its tag and sets the exit code, and nothing is shown.
async function run<A>(effect: Effect.Effect<A, { _tag: string; reason: string }>, show: (value: A) => void) {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag === "Left") {
    console.error(`${result.left._tag}: ${result.left.reason}`);
    process.exitCode = 1;
    return;
  }
  show(result.right);
}

async function sources(flags: Flags) {
  const prisma = database();
  try {
    const rows = await prisma.source.findMany({
      orderBy: { domain: "asc" },
      include: { feeds: { orderBy: { url: "asc" } } },
    });
    print(flags, rows, () =>
      table(
        rows.flatMap((source) =>
          source.feeds.map((feed, i) => ({
            domain: i === 0 ? source.domain : "",
            active: i === 0 ? (source.active ? "yes" : "no") : "",
            trust: i === 0 ? source.trust : "",
            failures: i === 0 ? source.consecutiveFailures : "",
            lastOk: i === 0 ? (source.lastOkAt?.toISOString().slice(0, 16) ?? "never") : "",
            kind: feed.kind,
            url: feed.url,
          })),
        ),
        { url: 70 },
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function feed(url: string, flags: Flags) {
  const since = windowStart(flags.date ? new Date(flags.date) : new Date());
  // The source's rules and trust, when the table has it; otherwise the items are scored bare.
  const known = sourceOf(url, await activeSources());
  return run(fetchFeed(url, allowedFor(url, known), liveDeps), (read) => {
    const items = read.items.map((item) => {
      const at = parseFeedDate(item.published);
      const link = canonicalize(unwrapRedirect(item.link));
      const scored = scoreItem({
        title: item.title,
        url: new URL(link),
        categories: item.categories,
        trust: known?.trust ?? 0,
        sectionRules: known?.sectionRules ?? [],
      });
      return {
        publishedAt: at?.toISOString().slice(0, 16) ?? "no date",
        window: at ? (at >= since ? "in" : "out") : "",
        text: item.textKind,
        score: scored.outcome === "scored" ? scored.score : "",
        decision: scored.outcome === "scored" ? "" : scored.reason,
        title: item.title,
        url: link,
      };
    });
    const source = known?.domain;
    const head = { url: read.url, format: read.format, charset: read.charset, bytes: read.bytes, source };
    print(flags, { ...head, items }, () =>
      [
        `${head.format}, ${head.charset}, ${head.bytes} bytes, ${items.length} items, source: ${source ?? "not in the sources table"}`,
        table(items, { title: 70, url: 60, decision: 28 }),
      ].join("\n"),
    );
  });
}

function page(url: string, flags: Flags) {
  return run(fetchArticle(url, liveDeps, allowedFor(url, null)), (article) =>
    print(flags, article, () =>
      [
        `title:     ${article.originalTitle}`,
        `canonical: ${article.canonicalUrl}`,
        `published: ${article.publishedAt ?? "(none)"}`,
        `site:      ${article.siteName ?? "(none)"}`,
        `text:      ${article.extractedText.length} chars`,
        "",
        article.extractedText.slice(0, 1200),
      ].join("\n"),
    ),
  );
}

async function runIngestion(flags: Flags) {
  const now = flags.date ? new Date(flags.date) : new Date();
  const prisma = flags.mock && flags.dryRun ? null : database();
  const world: { store: IngestStore; fetchDeps: typeof liveDeps } = prisma
    ? ingestWorld(flags.mock ? "mock" : "live", prisma, now)
    : { store: new MemoryStore(fixtureSources(), fixturePublished()), fetchDeps: fixtureDeps(now) };
  const silent = { log() {}, warn() {}, error() {} };
  const ingestion = ingest(
    {
      runId: randomUUID(),
      now,
      since: windowStart(now),
      onlySource: flags.source,
      dryRun: flags.dryRun,
      ignoreSeen: flags.ignoreSeen,
    },
    {
      ...world,
      fetchFeed,
      logger: silent,
      alert: (reason) => Effect.sync(() => console.warn(`[alert] ${reason}`)),
    },
  );
  try {
    await run(ingestion, (report) => {
      if (flags.report) {
        writeFileSync(flags.report, JSON.stringify(report, null, 2));
        console.error(`report written to ${flags.report}`);
      }
      print(flags, report, () => human(report));
    });
  } finally {
    await prisma?.$disconnect();
  }
}

const DECISION_ORDER = [
  "candidate",
  "seen",
  "discarded",
  "out_of_window",
  "future",
  "no_date",
  "off_domain",
  "bad_url",
];

function human(report: IngestReport): string {
  const s = summaryOf(report);
  const itemRow = (item: ItemReport) => ({
    decision: item.decision,
    reason: item.reason ?? "",
    score: item.score ?? "",
    source: item.source,
    title: item.title,
  });
  const items = [...report.items].sort(
    (a, b) =>
      DECISION_ORDER.indexOf(a.decision) - DECISION_ORDER.indexOf(b.decision) || (b.score ?? 0) - (a.score ?? 0),
  );
  return [
    `run ${s.runId}${s.dryRun ? " (dry run)" : ""} — ${s.date}, window from ${s.since}`,
    `${s.sources} sources, ${s.listed} listed, ${s.inWindow} in the window, ${s.candidates} candidates, ${s.groups} groups`,
    `${s.fichas} fichas stored, ${s.duplicates} already there, ${s.belowCutoff} below the cutoff, ${s.overCap} over the cap, ${s.republished} late copies`,
    s.sourcesFailed.length ? `failed sources: ${s.sourcesFailed.join(", ")}` : "",
    "",
    "== addresses",
    table(
      report.feeds.map((feed) => ({
        source: feed.source,
        ok: feed.ok ? "ok" : "FAIL",
        status: feed.status ?? "",
        listed: feed.listed,
        inWindow: feed.inWindow,
        candidates: feed.candidates,
        dropped: Object.entries(feed.dropped)
          .map(([decision, count]) => `${decision}:${count}`)
          .join(" "),
        error: feed.error ?? "",
        url: feed.url,
      })),
      { url: 60, error: 50 },
    ),
    "",
    "== groups (fichas first)",
    table(
      report.groupsDetail.map((group) => ({
        outcome: group.outcome,
        score: group.score,
        source: group.source,
        also: group.members.map((member) => member.source).join(", "),
        title: group.title,
        signals: group.signals.map((x) => `${x.signal}${x.points > 0 ? "+" : ""}${x.points}`).join(" "),
      })),
      { title: 70, signals: 90 },
    ),
    "",
    "== items",
    table(items.map(itemRow), { title: 80, reason: 30 }),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      json: { type: "boolean", default: false },
      date: { type: "string" },
      mock: { type: "boolean", default: false },
      source: { type: "string" },
      report: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "ignore-seen": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const [command, url] = positionals;
  const flags: Flags = {
    json: values.json,
    date: values.date,
    mock: values.mock,
    source: values.source,
    report: values.report,
    dryRun: values["dry-run"],
    ignoreSeen: values["ignore-seen"],
  };
  if (command === "sources") return sources(flags);
  if (command === "feed" && url) return feed(url, flags);
  if (command === "page" && url) return page(url, flags);
  if (command === "run") return runIngestion(flags);
  console.error(USAGE);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
