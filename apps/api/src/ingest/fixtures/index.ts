import type { FetchDeps } from "../../net/fetch";
import type { ActiveSource, SectionRule } from "../source";
import type { Known } from "../store";
import { titleSignature } from "../signature";
import { canonicalize, hostInDomain } from "../url";
import { FIXTURE_NOTE, PUBLISHED, STORIES, type FixtureSourceKey, type Story } from "./stories";

// The mocked world of an ingestion: invented sources on `.test` domains, their feeds built from
// `stories.ts` against the run's clock, the pages behind them, and a network that answers only
// these. The ingestion that runs over it is the real one — same parser, filters, score, groups and
// store — with no network and no model.

type FixtureSource = ActiveSource & { key: FixtureSourceKey };

const rules = (...list: [SectionRule["match"], string, SectionRule["tier"]][]): SectionRule[] =>
  list.map(([match, pattern, tier]) => ({ match, pattern, tier }));

const SOURCES: FixtureSource[] = [
  {
    key: "diario",
    id: "fixture-diario",
    domain: "diario-ficticio.test",
    name: "Diário Fictício",
    trust: 1,
    sectionRules: rules(
      ["path", "/patrocinado/", "discard"],
      ["path", "/opiniao/", "discard"],
      ["path", "/empresas/", "core"],
      ["path", "/financas/", "adjacent"],
      ["path", "/mundo/", "peripheral"],
    ),
    feeds: [
      { id: "fixture-diario-rss", kind: "feed", url: "https://www.diario-ficticio.test/rss/principal.xml" },
      // Answers XML that never closes: counted as a failed address, the source still read.
      { id: "fixture-diario-broken", kind: "feed", url: "https://www.diario-ficticio.test/rss/quebrado.xml" },
    ],
  },
  {
    key: "portal",
    id: "fixture-portal",
    domain: "portal-exemplo.test",
    name: "Portal Exemplo",
    trust: 0,
    sectionRules: rules(
      ["path", "/live/", "discard"],
      ["path", "/negocios/", "core"],
      ["path", "/economia/", "adjacent"],
      ["path", "/brasil/", "adjacent"],
      ["path", "/mercados/", "neutral"],
    ),
    feeds: [
      { id: "fixture-portal-sitemap", kind: "news_sitemap", url: "https://www.portal-exemplo.test/news-sitemap.xml" },
    ],
  },
  {
    key: "revista",
    id: "fixture-revista",
    domain: "revista-modelo.test",
    name: "Revista Modelo PME",
    trust: 0,
    sectionRules: rules(["category", "Esportes", "discard"], ["path", "/pme/", "core"]),
    feeds: [{ id: "fixture-revista-atom", kind: "feed", url: "https://revista-modelo.test/feed.atom" }],
  },
  {
    key: "agencia",
    id: "fixture-agencia",
    domain: "agencia-inventada.test",
    name: "Agência Inventada",
    trust: 1,
    sectionRules: rules(["path", "/economia/", "adjacent"]),
    feeds: [{ id: "fixture-agencia-rss", kind: "feed", url: "https://feeds.agencia-inventada.test/economia.xml" }],
  },
  {
    key: "offline",
    id: "fixture-offline",
    domain: "fonte-fora-do-ar.test",
    name: "Fonte Fora do Ar",
    trust: 0,
    sectionRules: [],
    feeds: [{ id: "fixture-offline-rss", kind: "feed", url: "https://fonte-fora-do-ar.test/feed/" }],
  },
];

export const fixtureSources = (): ActiveSource[] =>
  SOURCES.map((source) => ({
    id: source.id,
    domain: source.domain,
    name: source.name,
    trust: source.trust,
    sectionRules: source.sectionRules,
    feeds: source.feeds,
  }));

// The mocked world's allowlist: only the fixture's domains.
export const fixtureAllowed = (url: URL): boolean => SOURCES.some((s) => hostInDomain(url.hostname, s.domain));

const HOUR = 60 * 60 * 1000;
const byKey = (key: FixtureSourceKey) => SOURCES.find((s) => s.key === key) as FixtureSource;

// The day goes into the path after the section, so section rules still match and every day has
// its own links.
export function storyUrl(story: Story, now: Date): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "/");
  const [, section, ...rest] = story.path.split("/");
  const host = story.source === "revista" ? byKey("revista").domain : `www.${byKey(story.source).domain}`;
  return `https://${host}/${section}/${day}/${rest.join("/")}`;
}

// São Paulo wall clock, the fixed offset the feeds of Brazilian outlets write.
function spParts(date: Date) {
  const local = new Date(date.getTime() - 3 * HOUR);
  return { iso: local.toISOString().slice(0, 19), local };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function rfc822(date: Date): string {
  const { local } = spParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${WEEKDAYS[local.getUTCDay()]}, ${pad(local.getUTCDate())} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())} -0300`;
}

function dateOf(story: Story, now: Date): string | null {
  if (story.hoursAgo === null) return null;
  const at = new Date(now.getTime() - story.hoursAgo * HOUR);
  if (story.dateStyle === "iso_local") return spParts(at).iso;
  if (story.dateStyle === "iso") return at.toISOString();
  return rfc822(at);
}

const esc = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const storiesOf = (key: FixtureSourceKey) => STORIES.filter((s) => s.source === key);

function diarioRss(now: Date): string {
  const items = storiesOf("diario").map((s) => {
    const date = dateOf(s, now);
    const text = s.text ? `<p>${esc(s.text)}</p>` : "";
    return `<item>
  <title>${esc(s.title)}</title>
  <link>${storyUrl(s, now)}?utm_source=rss&amp;utm_medium=feed</link>
  ${date ? `<pubDate>${date}</pubDate>` : ""}
  ${s.category ? `<category><![CDATA[${s.category}]]></category>` : ""}
  ${s.full ? `<content:encoded><![CDATA[${text}]]></content:encoded>` : `<description>${esc(text)}</description>`}
</item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Diário Fictício</title><link>https://www.diario-ficticio.test/</link>
${items.join("\n")}
</channel></rss>`;
}

function portalSitemap(now: Date): string {
  const urls = storiesOf("portal").map((s) => {
    const date = dateOf(s, now);
    return `<url><loc>${storyUrl(s, now)}</loc><news:news>
  <news:publication><news:name>Portal Exemplo</news:name><news:language>pt</news:language></news:publication>
  ${date ? `<news:publication_date>${new Date(now.getTime() - (s.hoursAgo ?? 0) * HOUR).toISOString()}</news:publication_date>` : ""}
  <news:title><![CDATA[${s.title}]]></news:title>
</news:news></url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls.join("\n")}
</urlset>`;
}

function revistaAtom(now: Date): string {
  const entries = storiesOf("revista").map((s) => {
    const date = s.dateStyle
      ? dateOf(s, now)
      : s.hoursAgo === null
        ? null
        : new Date(now.getTime() - s.hoursAgo * HOUR).toISOString();
    return `<entry>
  <title>${esc(s.title)}</title>
  <link rel="alternate" href="${storyUrl(s, now)}"/>
  <id>${storyUrl(s, now)}</id>
  ${date ? `<published>${date}</published>` : ""}
  ${s.category ? `<category term="${esc(s.category)}"/>` : ""}
  ${s.text ? `<summary>${esc(s.text)}</summary>` : ""}
</entry>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Revista Modelo PME</title>
${entries.join("\n")}
</feed>`;
}

// RSS 0.91 in ISO-8859-1, with every link behind a redirector — the shape of a real Brazilian feed.
function agenciaRss(now: Date): string {
  const items = storiesOf("agencia").map((s) => {
    const date = dateOf(s, now);
    return `<item>
<title>${esc(s.title)}</title>
<link>https://redir.agencia-inventada.test/redir/rss/*${storyUrl(s, now)}</link>
<description>${esc(s.text ?? "")}</description>
${date ? `<pubDate>${date}</pubDate>` : ""}
</item>`;
  });
  return `<?xml version="1.0" encoding="ISO-8859-1" ?>
<rss version="0.91"><channel><title>Agência Inventada - Economia</title>
${items.join("\n")}
</channel></rss>`;
}

function page(story: Story, now: Date, text: string): string {
  const published = story.hoursAgo === null ? "" : new Date(now.getTime() - story.hoursAgo * HOUR).toISOString();
  const paragraphs = text
    .split(". ")
    .map((sentence) => `<p>${esc(sentence)}.</p>`)
    .join("\n");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(story.title)}</title>
<link rel="canonical" href="${storyUrl(story, now)}">
<meta property="article:published_time" content="${published}"></head>
<body><header>Menu</header><article><h1>${esc(story.title)}</h1>${paragraphs}</article><footer>${FIXTURE_NOTE}</footer></body></html>`;
}

type Answer = { status: number; type: string; body: Uint8Array | string };

// Every address the mocked world answers, for the run's clock.
export function fixtureRoutes(now: Date): Map<string, Answer> {
  const xml = (body: string | Uint8Array, type = "application/xml"): Answer => ({ status: 200, type, body });
  const routes = new Map<string, Answer>([
    ["https://www.diario-ficticio.test/rss/principal.xml", xml(diarioRss(now), "application/rss+xml; charset=utf-8")],
    ["https://www.diario-ficticio.test/rss/quebrado.xml", xml("<rss><channel><item><title>Sem fim", "text/xml")],
    ["https://www.portal-exemplo.test/news-sitemap.xml", xml(portalSitemap(now), "text/xml; charset=UTF-8")],
    ["https://revista-modelo.test/feed.atom", xml(revistaAtom(now), "application/atom+xml")],
    // No charset in the header: the prolog is what says ISO-8859-1.
    ["https://feeds.agencia-inventada.test/economia.xml", xml(Buffer.from(agenciaRss(now), "latin1"), "text/xml")],
    ["https://fonte-fora-do-ar.test/feed/", { status: 503, type: "text/html", body: "Service Unavailable" }],
  ]);
  // Pages answer at the canonical link, which is what a ficha stores and what the read asks for.
  for (const story of STORIES) {
    if (!story.page) continue;
    const url = canonicalize(storyUrl(story, now));
    if ("status" in story.page)
      routes.set(url, { status: story.page.status, type: "text/html", body: "Acesso restrito" });
    else if ("unreadable" in story.page)
      routes.set(url, {
        status: 200,
        type: "text/html; charset=utf-8",
        body: "<!doctype html><html><body></body></html>",
      });
    else routes.set(url, { status: 200, type: "text/html; charset=utf-8", body: page(story, now, story.page.text) });
  }
  return routes;
}

// A network that knows only the fixture: every name resolves to a public address — never
// connected to, the fetch answers from the routes — and every other URL is a 404.
export function fixtureDeps(now: Date): FetchDeps {
  const routes = fixtureRoutes(now);
  return {
    resolve: () => Promise.resolve([{ address: "200.1.2.3", family: 4 }]),
    fetch: (url) => {
      const answer = routes.get(url);
      const body = answer?.body ?? "Not Found";
      return Promise.resolve(
        new Response(typeof body === "string" ? body : new Uint8Array(body), {
          status: answer?.status ?? 404,
          headers: { "content-type": answer?.type ?? "text/html" },
        }),
      );
    },
  };
}

// What the newsletter already published, as the ingestion sees it: the late copy is judged against it.
export function fixturePublished(): Known[] {
  return PUBLISHED.map((p) => ({ url: p.path, signature: titleSignature(p.title) }));
}

export { STORIES } from "./stories";
