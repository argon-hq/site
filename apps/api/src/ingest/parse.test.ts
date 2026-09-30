import { describe, expect, it } from "vitest";
import { FeedMalformed, FULL_TEXT_MIN_CHARS, parseFeed } from "./parse";

const long = "Texto completo da notícia. ".repeat(40);

describe("parseFeed", () => {
  it("reads RSS 2.0: link, title, date, categories, and the full text from content:encoded", () => {
    const feed = parseFeed(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>Crédito &amp; juros</title><link>https://forbes.com.br/a/</link>
<pubDate>Tue, 29 Sep 2026 21:51:41 +0000</pubDate>
<category><![CDATA[Forbes Money]]></category><category>IPO</category>
<description><![CDATA[<p>Resumo curto da notícia, com mais de quarenta caracteres.</p>]]></description>
<content:encoded><![CDATA[<p>${long}</p><p>${long}</p>]]></content:encoded></item>
</channel></rss>`);
    expect(feed.format).toBe("rss");
    expect(feed.items).toHaveLength(1);
    const [item] = feed.items;
    expect(item?.title).toBe("Crédito & juros");
    expect(item?.link).toBe("https://forbes.com.br/a/");
    expect(item?.published).toBe("Tue, 29 Sep 2026 21:51:41 +0000");
    expect(item?.categories).toEqual(["Forbes Money", "IPO"]);
    expect(item?.textKind).toBe("full");
    expect(item?.text?.length).toBeGreaterThan(FULL_TEXT_MIN_CHARS);
    expect(item?.text).not.toContain("<p>");
  });

  it("calls a short content:encoded a summary, as Exame's first paragraph is", () => {
    const feed = parseFeed(`<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>T</title><link>https://exame.com/a/</link><pubDate>2026-09-29T18:29:35</pubDate>
<content:encoded><![CDATA[<p>Primeiro parágrafo da matéria, só ele, e um link.</p>]]></content:encoded></item>
</channel></rss>`);
    expect(feed.items[0]?.textKind).toBe("summary");
  });

  it("reads RSS 0.91 with HTML escaped in the description", () => {
    const feed = parseFeed(`<?xml version="1.0" encoding="ISO-8859-1" ?><rss version="0.91"><channel>
<item><title>Prospecto do IPO</title>
<link>https://redir.folha.com.br/redir/online/mercado/rss091/*https://www1.folha.uol.com.br/mercado/a.shtml</link>
<description>O &lt;a href=&quot;https://x&quot;&gt;prospecto&lt;/a&gt; do IPO mostra dependência de clientes.</description>
<pubDate>29 Sep 2026 22:30:00 -0300</pubDate></item></channel></rss>`);
    expect(feed.items[0]?.text).toBe("O prospecto do IPO mostra dependência de clientes.");
    expect(feed.items[0]?.textKind).toBe("summary");
  });

  it("reads Atom: the alternate link, published, category terms", () => {
    const feed = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Startup recebe aporte</title><link rel="self" href="https://x.test/self"/>
<link rel="alternate" href="https://x.test/pme/a"/><published>2026-09-29T10:00:00-03:00</published>
<category term="PME"/><summary>Resumo com mais de quarenta caracteres, para contar.</summary></entry></feed>`);
    expect(feed.format).toBe("atom");
    expect(feed.items[0]).toMatchObject({
      link: "https://x.test/pme/a",
      published: "2026-09-29T10:00:00-03:00",
      categories: ["PME"],
      textKind: "summary",
    });
  });

  it("reads a news sitemap: link, title and date, no text", () => {
    const feed = parseFeed(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
<url><loc>https://valor.globo.com/empresas/noticia/a.ghtml</loc><news:news>
<news:publication><news:name>valor</news:name><news:language>pt-BR</news:language></news:publication>
<news:publication_date>2026-09-30T01:15:30.195000+00:00</news:publication_date>
<news:title>Falha em motor</news:title></news:news></url>
<url><loc>https://valor.globo.com/pagina-sem-news</loc></url>
</urlset>`);
    expect(feed.format).toBe("news_sitemap");
    expect(feed.items).toEqual([
      {
        link: "https://valor.globo.com/empresas/noticia/a.ghtml",
        title: "Falha em motor",
        published: "2026-09-30T01:15:30.195000+00:00",
        text: null,
        textKind: "none",
        categories: [],
      },
    ]);
  });

  it("refuses XML that does not close, and a document that is not a feed", () => {
    expect(() => parseFeed("<rss><channel><item><title>Sem fim")).toThrow(FeedMalformed);
    expect(() => parseFeed("<html><body>Not found</body></html>")).toThrow(/not a feed/);
  });

  it("skips an item without link or title instead of failing the feed", () => {
    const feed = parseFeed(`<rss version="2.0"><channel>
<item><title>Sem link</title></item><item><link>https://x.test/a</link></item>
<item><title>Com tudo</title><link>https://x.test/b</link></item></channel></rss>`);
    expect(feed.items.map((i) => i.title)).toEqual(["Com tudo"]);
  });
});
