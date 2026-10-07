// Manual commands for the ingestion's reading: look at the sources, read one address or one page.
//
//   pnpm ingest:sources            the sources of the catalogue, with their addresses
//   pnpm ingest:feed <url>         one address: every item, its date, whether it is in the window
//   pnpm ingest:page <url>         one page: what the extraction gets out of it
//
// `--json` prints the raw result; `--date <ISO>` moves the window. Nothing is stored and no model
// is called.

import { Effect } from "effect";
import { parseArgs } from "node:util";
import { CATALOG, catalogSourceOf } from "../src/ingest/catalog";
import { parseFeedDate } from "../src/ingest/dates";
import { fetchFeed } from "../src/ingest/fetch-feed";
import { canonicalize, hostInDomain, unwrapRedirect } from "../src/ingest/url";
import { fetchArticle } from "../src/mastra/tools/read-page";
import { liveDeps, type Allowed } from "../src/net/fetch";
import { windowStart } from "../src/pipeline/rules";

const USAGE = "usage: ingest sources | feed <url> [--date ISO] | page <url>   [--json]";

type Flags = { json: boolean; date?: string };
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
// `www.`, and the site may well redirect to it. An address outside the catalogue is held to its own
// domain.
function allowedFor(url: string): Allowed {
  const domain = catalogSourceOf(url)?.domain ?? new URL(url).hostname.replace(/^www\./, "");
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

function sources(flags: Flags) {
  print(flags, CATALOG, () =>
    table(
      CATALOG.flatMap((source) =>
        source.feeds.map((feed, i) => ({
          domain: i === 0 ? source.domain : "",
          active: i === 0 ? (source.active ? "yes" : "no") : "",
          trust: i === 0 ? source.trust : "",
          kind: feed.kind,
          url: feed.url,
        })),
      ),
      { url: 70 },
    ),
  );
}

function feed(url: string, flags: Flags) {
  const since = windowStart(flags.date ? new Date(flags.date) : new Date());
  return run(fetchFeed(url, allowedFor(url), liveDeps), (read) => {
    const items = read.items.map((item) => {
      const at = parseFeedDate(item.published);
      return {
        publishedAt: at?.toISOString().slice(0, 16) ?? "no date",
        window: at ? (at >= since ? "in" : "out") : "",
        text: item.textKind,
        categories: item.categories.join(", "),
        title: item.title,
        url: canonicalize(unwrapRedirect(item.link)),
      };
    });
    const source = catalogSourceOf(url)?.domain;
    const head = { url: read.url, format: read.format, charset: read.charset, bytes: read.bytes, source };
    print(flags, { ...head, items }, () =>
      [
        `${head.format}, ${head.charset}, ${head.bytes} bytes, ${items.length} items, source: ${source ?? "not in the catalogue"}`,
        table(items, { title: 70, url: 60, categories: 24 }),
      ].join("\n"),
    );
  });
}

function page(url: string, flags: Flags) {
  return run(fetchArticle(url, liveDeps, allowedFor(url)), (article) =>
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

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { json: { type: "boolean", default: false }, date: { type: "string" } },
    allowPositionals: true,
  });
  const [command, url] = positionals;
  const flags: Flags = { json: values.json, date: values.date };
  if (command === "sources") return sources(flags);
  if (command === "feed" && url) return feed(url, flags);
  if (command === "page" && url) return page(url, flags);
  console.error(USAGE);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
