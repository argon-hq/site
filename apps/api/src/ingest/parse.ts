import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parseHTML } from "linkedom";

// What the feed itself says about its text. `full` spares the page read later, and outlives the
// feed: InfoMoney replaces its ten items every forty minutes, so the text is kept only when it is
// the whole article. `summary` is a lead; `none` is a sitemap entry, title and link only.
export type TextKind = "full" | "summary" | "none";
export type FeedFormat = "rss" | "atom" | "news_sitemap";

export type FeedItem = {
  link: string;
  title: string;
  published: string | null; // as the feed wrote it; read by `parseFeedDate`
  text: string | null;
  textKind: TextKind;
  categories: string[];
};

export type ParsedFeed = { format: FeedFormat; items: FeedItem[] };

export class FeedMalformed extends Error {}

// Below this many characters, the text the feed calls content is a lead, not the article.
export const FULL_TEXT_MIN_CHARS = 600;
const SUMMARY_MIN_CHARS = 40;

const REPEATED = new Set(["item", "entry", "url", "category", "link"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name: string) => REPEATED.has(name),
});

// RSS 2.0 and 0.91, Atom, and news sitemaps. Anything else, or XML that does not close, is a
// malformed feed: the caller counts it as a failure of the address, not of the run.
export function parseFeed(xml: string): ParsedFeed {
  const checked = XMLValidator.validate(xml);
  if (checked !== true) throw new FeedMalformed(`invalid xml: ${checked.err.msg} (line ${checked.err.line})`);

  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = obj(doc.rss);
  if (rss) return { format: "rss", items: list(obj(rss.channel)?.item).map(rssItem).filter(isItem) };
  const feed = obj(doc.feed);
  if (feed) return { format: "atom", items: list(feed.entry).map(atomEntry).filter(isItem) };
  const urlset = obj(doc.urlset);
  if (urlset) return { format: "news_sitemap", items: list(urlset.url).map(sitemapEntry).filter(isItem) };
  throw new FeedMalformed(`not a feed or a news sitemap: root is ${Object.keys(doc).join(", ") || "empty"}`);
}

function rssItem(raw: unknown): FeedItem | null {
  const item = obj(raw);
  if (!item) return null;
  const link = str(list(item.link)[0]) ?? str(item.guid);
  const title = plain(str(item.title));
  if (!link || !title) return null;
  const full = plain(str(item["content:encoded"]));
  const summary = plain(str(item.description));
  return {
    link,
    title,
    published: str(item.pubDate) ?? str(item["dc:date"]),
    ...textOf(full, summary),
    categories: list(item.category).flatMap((c) => str(c) ?? []),
  };
}

function atomEntry(raw: unknown): FeedItem | null {
  const entry = obj(raw);
  if (!entry) return null;
  const links = list(entry.link)
    .map(obj)
    .filter((l): l is Record<string, unknown> => l !== null);
  const alternate = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
  const link = alternate ? str(alternate["@_href"]) : null;
  const title = plain(str(entry.title));
  if (!link || !title) return null;
  return {
    link,
    title,
    published: str(entry.published) ?? str(entry.updated),
    ...textOf(plain(str(entry.content)), plain(str(entry.summary))),
    categories: list(entry.category).flatMap((c) => str(obj(c)?.["@_term"]) ?? str(c) ?? []),
  };
}

function sitemapEntry(raw: unknown): FeedItem | null {
  const url = obj(raw);
  const news = obj(url?.["news:news"]);
  const link = str(url?.loc);
  // A sitemap entry without `news:news` is a plain page, not news: it has no title and no date.
  const title = plain(str(news?.["news:title"]));
  if (!link || !title) return null;
  return {
    link,
    title,
    published: str(news?.["news:publication_date"]),
    text: null,
    textKind: "none",
    categories: [],
  };
}

function textOf(full: string | null, summary: string | null): { text: string | null; textKind: TextKind } {
  if (full && full.length >= FULL_TEXT_MIN_CHARS) return { text: full, textKind: "full" };
  const lead = full ?? summary;
  if (lead && lead.length >= SUMMARY_MIN_CHARS) return { text: lead, textKind: "summary" };
  return { text: null, textKind: "none" };
}

// Feed text is HTML more often than not, escaped once for the XML: the parser undoes the XML, the
// DOM undoes the HTML and keeps what a reader would see.
function plain(value: string | null): string | null {
  if (!value) return null;
  const text = /[<&]/.test(value) ? htmlText(value) : value;
  const squeezed = text.replace(/\s+/g, " ").trim();
  return squeezed || null;
}

function htmlText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  for (const node of Array.from(document.querySelectorAll("script, style"))) node.remove();
  // Block elements end a sentence; without a space between them two paragraphs glue together.
  for (const node of Array.from(document.querySelectorAll("p, br, div, li, h1, h2, h3, h4"))) node.append(" ");
  return document.body.textContent ?? "";
}

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// A text node, whether the parser gave it bare or, because it has attributes, under `#text`.
function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  const node = obj(value);
  return node ? str(node["#text"]) : null;
}

function isItem(item: FeedItem | null): item is FeedItem {
  return item !== null;
}
