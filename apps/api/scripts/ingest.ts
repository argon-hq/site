// Manual commands for the ingestion: look at the sources, read one address or one page, and run the
// whole ingestion — over the real feeds or the fixture — item by item, to calibrate the triage.
//
//   pnpm ingest:sources                       sources and addresses, with their health
//   pnpm ingest:feed <url> [--source d]       one address: every item and how it would be judged
//   pnpm ingest:page <url>                    one page: what the extraction gets out of it
//   pnpm ingest:run [--mock] [--source d] [--date ISO] [--dry-run] [--ignore-seen]
//                   [--json] [--report file]  the ingestion, with every item, group and reason
//
// `--mock` reads the fixture's invented sources, with no network; with `--dry-run` as well it needs
// no database either. Anything else reads the sources table of DATABASE_URL. `--dry-run` writes
// nothing — no ficha, no seen link, no source health — and `--ignore-seen` judges again what earlier
// runs already listed, which is how the weights are recalibrated.
//
// Wires the pieces by hand instead of booting Nest: the commands need the database and the network,
// not the HTTP layer, the agents or the guard.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { fetchFeed } from "../src/ingest/fetch-feed";
import { fixtureDeps, fixturePublished, fixtureSources } from "../src/ingest/fixtures";
import { ingest, summaryOf, type IngestReport, type ItemReport } from "../src/ingest/ingest";
import { MemoryStore } from "../src/ingest/memory-store";
import { ingestWorld } from "../src/ingest/mode";
import { parseFeedDate } from "../src/ingest/dates";
import { scoreItem } from "../src/ingest/score";
import type { ActiveSource } from "../src/ingest/source";
import { prismaIngestStore, type IngestStore } from "../src/ingest/store";
import { canonicalize, hostInDomain, unwrapRedirect } from "../src/ingest/url";
import { fetchArticle } from "../src/mastra/tools/read-page";
import { liveDeps, type FetchDeps } from "../src/net/fetch";
import { windowStart } from "../src/pipeline/rules";
import { PrismaService } from "../src/prisma/prisma.service";

type Flags = { [key: string]: string | boolean | undefined };

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Flags } {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (["source", "date", "report"].includes(key) && next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else flags[key] = true;
  }
  return { command, positional, flags };
}

function database(): PrismaService {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (apps/api/.env)");
  return new PrismaService(url);
}

// A table that fits a terminal: columns padded to the widest cell, long ones cut.
function table(rows: Record<string, unknown>[], widths: Record<string, number> = {}): string {
  if (rows.length === 0) return "(none)";
  const keys = Object.keys(rows[0] as object);
  const cell = (key: string, value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    const max = widths[key] ?? 60;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const size = Object.fromEntries(keys.map((k) => [k, Math.max(k.length, ...rows.map((r) => cell(k, r[k]).length))]));
  const line = (values: string[]) => values.map((v, i) => v.padEnd(size[keys[i] as string] as number)).join("  ");
  return [
    line(keys),
    line(keys.map((k) => "-".repeat(size[k] as number))),
    ...rows.map((r) => line(keys.map((k) => cell(k, r[k])))),
  ].join("\n");
}

const print = (flags: Flags, value: unknown, human: () => string) =>
  console.log(flags.json ? JSON.stringify(value, null, 2) : human());

async function sources(flags: Flags) {
  const prisma = database();
  try {
    const rows = await prisma.source.findMany({
      orderBy: { domain: "asc" },
      include: { feeds: { orderBy: { url: "asc" } } },
    });
    print(flags, rows, () =>
      table(
        rows.flatMap((s) =>
          s.feeds.map((f, i) => ({
            domain: i === 0 ? s.domain : "",
            active: i === 0 ? (s.active ? "yes" : "no") : "",
            trust: i === 0 ? s.trust : "",
            failures: i === 0 ? s.consecutiveFailures : "",
            lastOk: i === 0 ? (s.lastOkAt?.toISOString().slice(0, 16) ?? "never") : "",
            rules: i === 0 ? (s.sectionRules as unknown[]).length : "",
            kind: f.kind,
            url: f.url,
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
  const now = flags.date ? new Date(String(flags.date)) : new Date();
  const since = windowStart(now);
  // The source's rules, when the table has it; otherwise the feed is read with none.
  let rules: ActiveSource | null = null;
  const domain = typeof flags.source === "string" ? flags.source : new URL(url).hostname.replace(/^www\./, "");
  if (process.env.DATABASE_URL) {
    const prisma = database();
    try {
      const found = (await Effect.runPromise(prismaIngestStore(prisma).activeSources())).find((s) =>
        hostInDomain(new URL(url).hostname, s.domain),
      );
      rules = found ?? null;
    } finally {
      await prisma.$disconnect();
    }
  }
  const allowed = (u: string) => URL.canParse(u) && hostInDomain(new URL(u).hostname, rules?.domain ?? domain);
  const read = await Effect.runPromise(Effect.either(fetchFeed(url, allowed, liveDeps)));
  if (read._tag === "Left") {
    console.error(`${read.left._tag}: ${read.left.reason}`);
    process.exitCode = 1;
    return;
  }
  const items = read.right.items.map((item) => {
    const link = canonicalize(unwrapRedirect(item.link));
    const at = parseFeedDate(item.published);
    const scored = scoreItem({
      title: item.title,
      url: new URL(link),
      categories: item.categories,
      trust: rules?.trust ?? 0,
      sectionRules: rules?.sectionRules ?? [],
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
  print(
    flags,
    {
      format: read.right.format,
      charset: read.right.charset,
      bytes: read.right.bytes,
      rules: rules?.domain ?? null,
      items,
    },
    () =>
      [
        `${read.right.format}, ${read.right.charset}, ${read.right.bytes} bytes, ${items.length} items, rules: ${rules?.domain ?? "none"}`,
        table(items, { title: 70, url: 60 }),
      ].join("\n"),
  );
}

async function page(url: string, flags: Flags) {
  const host = new URL(url).hostname;
  const read = await Effect.runPromise(Effect.either(fetchArticle(url, liveDeps, (u) => new URL(u).hostname === host)));
  if (read._tag === "Left") {
    console.error(`${read.left._tag}: ${read.left.reason}`);
    process.exitCode = 1;
    return;
  }
  const a = read.right;
  print(flags, a, () =>
    [
      `title:     ${a.originalTitle}`,
      `canonical: ${a.canonicalUrl}`,
      `published: ${a.publishedAt ?? "(none)"}`,
      `site:      ${a.siteName ?? "(none)"}`,
      `text:      ${a.extractedText.length} chars`,
      "",
      a.extractedText.slice(0, 1200),
    ].join("\n"),
  );
}

async function run(flags: Flags) {
  const now = flags.date ? new Date(String(flags.date)) : new Date();
  const mock = Boolean(flags.mock);
  const dryRun = Boolean(flags["dry-run"]);
  const needsDb = !(mock && dryRun);
  const prisma = needsDb ? database() : null;
  let store: IngestStore;
  let fetchDeps: FetchDeps;
  if (prisma) ({ store, fetchDeps } = ingestWorld(mock ? "mock" : "live", prisma, now));
  else {
    store = new MemoryStore(fixtureSources(), fixturePublished());
    fetchDeps = fixtureDeps(now);
  }

  const silent = { log() {}, warn() {}, error() {} };
  try {
    const report = await Effect.runPromise(
      ingest(
        {
          runId: randomUUID(),
          now,
          since: windowStart(now),
          onlySource: typeof flags.source === "string" ? flags.source : undefined,
          ignoreSeen: Boolean(flags["ignore-seen"]),
          dryRun,
        },
        {
          store,
          fetchFeed,
          fetchDeps,
          logger: silent,
          alert: (reason) => Effect.sync(() => console.warn(`[alert] ${reason}`)),
        },
      ),
    );
    if (typeof flags.report === "string") {
      writeFileSync(flags.report, JSON.stringify(report, null, 2));
      console.error(`report written to ${flags.report}`);
    }
    print(flags, report, () => human(report));
  } finally {
    await prisma?.$disconnect();
  }
}

function human(report: IngestReport): string {
  const s = summaryOf(report);
  const itemRow = (i: ItemReport) => ({
    decision: i.decision,
    reason: i.reason ?? "",
    score: i.score ?? "",
    source: i.source,
    title: i.title,
  });
  const order = ["candidate", "seen", "discarded", "out_of_window", "future", "no_date", "off_domain", "bad_url"];
  const items = [...report.items].sort((a, b) => order.indexOf(a.decision) - order.indexOf(b.decision));
  return [
    `run ${s.runId}${s.dryRun ? " (dry run)" : ""} — ${s.date}, window from ${s.since}`,
    `${s.sources} sources, ${s.listed} listed, ${s.inWindow} in the window, ${s.candidates} candidates, ${s.groups} groups`,
    `${s.fichas} fichas stored, ${s.duplicates} already there, ${s.belowCutoff} below the cutoff, ${s.overCap} over the cap, ${s.republished} late copies`,
    s.sourcesFailed.length ? `failed sources: ${s.sourcesFailed.join(", ")}` : "",
    "",
    "== addresses",
    table(
      report.feeds.map((f) => ({
        source: f.source,
        ok: f.ok ? "ok" : "FAIL",
        status: f.status ?? "",
        listed: f.listed,
        inWindow: f.inWindow,
        candidates: f.candidates,
        dropped: Object.entries(f.dropped)
          .map(([k, v]) => `${k}:${v}`)
          .join(" "),
        error: f.error ?? "",
        url: f.url,
      })),
      { url: 60, error: 50 },
    ),
    "",
    "== groups (fichas first)",
    table(
      report.groupsDetail.map((g) => ({
        outcome: g.outcome,
        score: g.score,
        source: g.source,
        also: g.members.map((m) => m.source).join(", "),
        title: g.title,
        signals: g.signals.map((x) => `${x.signal}${x.points > 0 ? "+" : ""}${x.points}`).join(" "),
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
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  if (command === "sources") return sources(flags);
  if (command === "feed" && positional[0]) return feed(positional[0], flags);
  if (command === "page" && positional[0]) return page(positional[0], flags);
  if (command === "run") return run(flags);
  console.error(
    "usage: ingest sources | feed <url> [--source d] | page <url> | run [--mock] [--source d] [--date ISO] [--dry-run] [--ignore-seen] [--json] [--report file]",
  );
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
