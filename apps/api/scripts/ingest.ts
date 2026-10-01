// Manual commands for the ingestion's reading: look at the sources, read one address or one page.
//
//   pnpm ingest:sources            the sources of the catalogue, with their addresses
//   pnpm ingest:feed <url>         one address: every item, its date, whether it is in the window
//   pnpm ingest:page <url>         one page: what the extraction gets out of it
//
// `--json` prints the raw result. Nothing is stored and no model is called.

import { Effect } from "effect";
import { CATALOG } from "../src/ingest/catalog";
import { parseFeedDate } from "../src/ingest/dates";
import { fetchFeed } from "../src/ingest/fetch-feed";
import { canonicalize, hostInDomain, unwrapRedirect } from "../src/ingest/url";
import { fetchArticle } from "../src/mastra/tools/read-page";
import { liveDeps } from "../src/net/fetch";
import { windowStart } from "../src/pipeline/rules";

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
    if (key === "date" && next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else flags[key] = true;
  }
  return { command, positional, flags };
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

function sources(flags: Flags) {
  print(flags, CATALOG, () =>
    table(
      CATALOG.flatMap((s) =>
        s.feeds.map((f, i) => ({
          domain: i === 0 ? s.domain : "",
          active: i === 0 ? (s.active ? "yes" : "no") : "",
          trust: i === 0 ? s.trust : "",
          kind: f.kind,
          url: f.url,
        })),
      ),
      { url: 70 },
    ),
  );
}

async function feed(url: string, flags: Flags) {
  const now = flags.date ? new Date(String(flags.date)) : new Date();
  const since = windowStart(now);
  // Only the source's own domain may be read, as in a run.
  const source = CATALOG.find((s) => hostInDomain(new URL(url).hostname, s.domain));
  const domain = source?.domain ?? new URL(url).hostname.replace(/^www\./, "");
  const allowed = (u: string) => URL.canParse(u) && hostInDomain(new URL(u).hostname, domain);
  const read = await Effect.runPromise(Effect.either(fetchFeed(url, allowed, liveDeps)));
  if (read._tag === "Left") {
    console.error(`${read.left._tag}: ${read.left.reason}`);
    process.exitCode = 1;
    return;
  }
  const items = read.right.items.map((item) => {
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
  const head = {
    format: read.right.format,
    charset: read.right.charset,
    bytes: read.right.bytes,
    source: source?.domain,
  };
  print(flags, { ...head, items }, () =>
    [
      `${head.format}, ${head.charset}, ${head.bytes} bytes, ${items.length} items, source: ${head.source ?? "not in the catalogue"}`,
      table(items, { title: 70, url: 60, categories: 24 }),
    ].join("\n"),
  );
}

async function page(url: string, flags: Flags) {
  // The source's domain and its subdomains, as in a run: a canonical link has no `www.`, and the
  // site may well redirect to it.
  const host = new URL(url).hostname;
  const domain = CATALOG.find((s) => hostInDomain(host, s.domain))?.domain ?? host.replace(/^www\./, "");
  const allowed = (u: string) => URL.canParse(u) && hostInDomain(new URL(u).hostname, domain);
  const read = await Effect.runPromise(Effect.either(fetchArticle(url, liveDeps, allowed)));
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

async function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  if (command === "sources") return sources(flags);
  if (command === "feed" && positional[0]) return feed(positional[0], flags);
  if (command === "page" && positional[0]) return page(positional[0], flags);
  console.error("usage: ingest sources | feed <url> [--date ISO] | page <url>   [--json]");
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
