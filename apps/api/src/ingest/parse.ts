import { Data } from "effect";
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

// XML that does not close, or a document that is neither a feed nor a news sitemap.
export class FeedMalformed extends Data.TaggedError("FeedMalformed")<{ reason: string }> {}

// Below this many characters, the text the feed calls content is a lead, not the article.
export const FULL_TEXT_MIN_CHARS = 600;
const SUMMARY_MIN_CHARS = 40;

// Elements that may repeat under their parent, so one of them is read the same way as many.
const REPEATED = new Set(["item", "entry", "url", "category", "link"]);
// The elements a plain text node is laid out by: a space between them keeps two paragraphs apart.
const BLOCK_ELEMENTS = "p, br, div, li, h1, h2, h3, h4";

type Node = Record<string, unknown>;

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
  if (checked !== true)
    throw new FeedMalformed({ reason: `invalid xml: ${checked.err.msg} (line ${checked.err.line})` });

  const doc = parser.parse(xml) as Node;
  const rss = node(doc.rss);
  if (rss) return { format: "rss", items: items(node(rss.channel)?.item, rssItem) };
  const feed = node(doc.feed);
  if (feed) return { format: "atom", items: items(feed.entry, atomEntry) };
  const urlset = node(doc.urlset);
  if (urlset) return { format: "news_sitemap", items: items(urlset.url, sitemapEntry) };
  throw new FeedMalformed({
    reason: `not a feed or a news sitemap: root is ${Object.keys(doc).join(", ") || "empty"}`,
  });
}

// Every entry the reader can make an item of; the ones without a link or a title are skipped, not
// the feed.
const items = (raw: unknown, read: (entry: Node) => FeedItem | null): FeedItem[] =>
  nodes(raw).flatMap((entry) => read(entry) ?? []);

function rssItem(item: Node): FeedItem | null {
  // A guid is a link only when the feed does not say otherwise — `isPermaLink="false"` marks an
  // opaque id, as Forbes uses.
  const guid = node(item.guid)?.["@_isPermaLink"] === "false" ? null : httpUrl(item.guid);
  const link = httpUrl(list(item.link)[0]) ?? guid;
  const title = plain(str(item.title));
  if (!link || !title) return null;
  return {
    link,
    title,
    published: str(item.pubDate) ?? str(item["dc:date"]),
    ...textOf(plain(str(item["content:encoded"])), plain(str(item.description))),
    categories: list(item.category).flatMap((category) => str(category) ?? []),
  };
}

function atomEntry(entry: Node): FeedItem | null {
  const links = nodes(entry.link);
  const alternate = links.find((link) => !link["@_rel"] || link["@_rel"] === "alternate") ?? links[0];
  const link = httpUrl(alternate?.["@_href"]);
  const title = plain(str(entry.title));
  if (!link || !title) return null;
  return {
    link,
    title,
    published: str(entry.published) ?? str(entry.updated),
    ...textOf(plain(str(entry.content)), plain(str(entry.summary))),
    categories: list(entry.category).flatMap((category) => str(node(category)?.["@_term"]) ?? str(category) ?? []),
  };
}

function sitemapEntry(url: Node): FeedItem | null {
  // A sitemap entry without `news:news` is a plain page, not news: it has no title and no date.
  const news = node(url["news:news"]);
  const link = httpUrl(url.loc);
  const title = plain(str(news?.["news:title"]));
  if (!link || !title) return null;
  return { link, title, published: str(news?.["news:publication_date"]), text: null, textKind: "none", categories: [] };
}

function textOf(full: string | null, summary: string | null): Pick<FeedItem, "text" | "textKind"> {
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
  return text.replace(/\s+/g, " ").trim() || null;
}

function htmlText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  for (const element of Array.from(document.querySelectorAll("script, style"))) element.remove();
  for (const element of Array.from(document.querySelectorAll(BLOCK_ELEMENTS))) element.append(" ");
  return document.body.textContent ?? "";
}

// A link an item can be read from: absolute, over http(s). Anything else — a relative path, a bare
// id — is no link, and the item is skipped rather than failing downstream on `new URL`.
function httpUrl(value: unknown): string | null {
  const text = str(value);
  if (!text || !URL.canParse(text)) return null;
  const { protocol } = new URL(text);
  return protocol === "https:" || protocol === "http:" ? text : null;
}

function node(value: unknown): Node | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Node) : null;
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// The element nodes among one value or many; text and nothing are left out.
function nodes(value: unknown): Node[] {
  return list(value).filter((entry): entry is Node => node(entry) !== null);
}

// A text node, whether the parser gave it bare or, because it has attributes, under `#text`.
function str(value: unknown): string | null {
  const text = typeof value === "string" ? value : node(value)?.["#text"];
  return typeof text === "string" ? text.trim() || null : null;
}
