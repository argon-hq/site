import { hostInDomain } from "./url";
import type { ActiveSource, SectionRule, SourceFeed } from "./source";

// The sources of the survey of 29/09/2026 (ARG-123), with their addresses and section rules. For now
// they live here, in code, and only the manual commands and the tests read them: the ingestion only
// reads and judges, it stores nothing. The next step moves them into a table, per environment,
// written through internal routes; this list becomes that table's first rows.
export type CatalogSource = {
  domain: string;
  name: string;
  covers: string;
  trust: number;
  active: boolean;
  sectionRules: readonly SectionRule[];
  feeds: readonly Omit<SourceFeed, "id">[];
};

export const CATALOG: readonly CatalogSource[] = [
  {
    domain: "agenciabrasil.ebc.com.br",
    name: "Agência Brasil",
    covers: "indicadores, medidas do governo com efeito em negócios",
    trust: 1,
    active: true,
    sectionRules: [
      { match: "path", pattern: "/esportes/", tier: "discard" },
      { match: "path", pattern: "/economia/", tier: "adjacent" },
      { match: "path", pattern: "/geral/", tier: "adjacent" },
      { match: "path", pattern: "/politica/", tier: "peripheral" },
      { match: "path", pattern: "/internacional/", tier: "peripheral" },
    ],
    feeds: [
      { kind: "feed", url: "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml" },
      { kind: "feed", url: "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml" },
    ],
  },
  {
    domain: "valor.globo.com",
    name: "Valor Econômico",
    covers: "empresas, negócios, finanças",
    trust: 1,
    active: true,
    sectionRules: [
      { match: "path", pattern: "/patrocinado/", tier: "discard" },
      { match: "path", pattern: "/conteudo-de-marca/", tier: "discard" },
      { match: "path", pattern: "/opiniao/", tier: "discard" },
      { match: "path", pattern: "/eu-e/", tier: "discard" },
      { match: "path", pattern: "/impresso/", tier: "discard" },
      { match: "path", pattern: "/politica/coluna/", tier: "discard" },
      { match: "path", pattern: "/legislacao/coluna/", tier: "discard" },
      { match: "path", pattern: "/financas/coluna/", tier: "discard" },
      { match: "path", pattern: "/empresas/coluna/", tier: "discard" },
      { match: "path", pattern: "/brasil/coluna/", tier: "discard" },
      { match: "path", pattern: "/empresas/", tier: "core" },
      { match: "path", pattern: "/legislacao/", tier: "core" },
      { match: "path", pattern: "/agronegocios/", tier: "core" },
      { match: "path", pattern: "/financas/", tier: "adjacent" },
      { match: "path", pattern: "/brasil/", tier: "adjacent" },
      { match: "path", pattern: "/carreira/", tier: "adjacent" },
      { match: "path", pattern: "/politica/", tier: "peripheral" },
      { match: "path", pattern: "/mundo/", tier: "peripheral" },
    ],
    feeds: [
      { kind: "news_sitemap", url: "https://valor.globo.com/sitemap/valor/news.xml" },
      { kind: "feed", url: "https://valor.globo.com/rss/valor/empresas" },
    ],
  },
  {
    domain: "infomoney.com.br",
    name: "InfoMoney",
    covers: "negócios, mercado, empreendedorismo",
    trust: 0,
    active: true,
    sectionRules: [
      { match: "path", pattern: "/live/", tier: "discard" },
      { match: "path", pattern: "/colunistas/", tier: "discard" },
      { match: "path", pattern: "/esportes/", tier: "discard" },
      { match: "path", pattern: "/web-stories/", tier: "discard" },
      { match: "path", pattern: "/patrocinado/", tier: "discard" },
      { match: "path", pattern: "/business/", tier: "core" },
      { match: "path", pattern: "/negocios/", tier: "core" },
      { match: "path", pattern: "/economia/", tier: "adjacent" },
      { match: "path", pattern: "/brasil/", tier: "adjacent" },
      { match: "path", pattern: "/consumo/", tier: "adjacent" },
      { match: "path", pattern: "/minhas-financas/", tier: "adjacent" },
      { match: "path", pattern: "/carreira/", tier: "adjacent" },
      { match: "path", pattern: "/tecnologia/", tier: "adjacent" },
      { match: "path", pattern: "/politica/", tier: "peripheral" },
      { match: "path", pattern: "/mundo/", tier: "peripheral" },
    ],
    feeds: [
      { kind: "news_sitemap", url: "https://www.infomoney.com.br/news-sitemap.xml" },
      { kind: "feed", url: "https://www.infomoney.com.br/feed/" },
    ],
  },
  {
    domain: "exame.com",
    name: "Exame",
    covers: "negócios, PME, gestão",
    trust: 0,
    active: true,
    sectionRules: [
      { match: "path", pattern: "/esporte/", tier: "discard" },
      { match: "path", pattern: "/pop/", tier: "discard" },
      { match: "path", pattern: "/colunistas/", tier: "discard" },
      { match: "path", pattern: "/negocios/", tier: "core" },
      { match: "path", pattern: "/pme/", tier: "core" },
      { match: "path", pattern: "/brasil/", tier: "adjacent" },
      { match: "path", pattern: "/economia/", tier: "adjacent" },
      { match: "path", pattern: "/tecnologia/", tier: "adjacent" },
      { match: "path", pattern: "/inteligencia-artificial/", tier: "adjacent" },
      { match: "path", pattern: "/carreira/", tier: "adjacent" },
      { match: "path", pattern: "/mundo/", tier: "peripheral" },
    ],
    feeds: [{ kind: "feed", url: "https://exame.com/feed/" }],
  },
  {
    domain: "folha.uol.com.br",
    name: "Folha Mercado",
    covers: "mercado, empresas",
    trust: 1,
    active: true,
    sectionRules: [
      { match: "host", pattern: "aovivo.", tier: "discard" },
      { match: "path", pattern: "/colunas/", tier: "discard" },
      { match: "path", pattern: "/blogs/", tier: "discard" },
      { match: "path", pattern: "/negocios/", tier: "core" },
      { match: "path", pattern: "/mercado/", tier: "adjacent" },
      { match: "path", pattern: "/ia/", tier: "adjacent" },
      { match: "path", pattern: "/financas/", tier: "adjacent" },
      { match: "path", pattern: "/tec/", tier: "adjacent" },
      { match: "path", pattern: "/agro/", tier: "adjacent" },
      { match: "path", pattern: "/infraestrutura/", tier: "adjacent" },
      { match: "path", pattern: "/economia-sustentavel/", tier: "adjacent" },
      { match: "path", pattern: "/mundo/", tier: "peripheral" },
      { match: "path", pattern: "/poder/", tier: "peripheral" },
    ],
    feeds: [{ kind: "feed", url: "https://feeds.folha.uol.com.br/mercado/rss091.xml" }],
  },
  {
    domain: "forbes.com.br",
    name: "Forbes Brasil",
    covers: "negócios, empreendedorismo",
    trust: 0,
    active: true,
    sectionRules: [
      { match: "path", pattern: "/forbes-life/", tier: "discard" },
      { match: "path", pattern: "/forbeslife/", tier: "discard" },
      { match: "path", pattern: "/colunas/", tier: "discard" },
      { match: "category", pattern: "Esporte", tier: "discard" },
      { match: "category", pattern: "Pop", tier: "discard" },
      { match: "category", pattern: "BrandVoice", tier: "discard" },
      { match: "category", pattern: "Forbes Sports", tier: "discard" },
      { match: "path", pattern: "/forbes-tech/", tier: "adjacent" },
      { match: "path", pattern: "/forbes-agro/", tier: "adjacent" },
      { match: "path", pattern: "/carreira/", tier: "adjacent" },
    ],
    feeds: [{ kind: "feed", url: "https://forbes.com.br/feed/" }],
  },
  // Kept for the source review (ARG-123, item 8): no focused feed, and a robot is refused.
  {
    domain: "forbes.com",
    name: "Forbes",
    covers: "entrepreneurs, small business, leadership",
    trust: 0,
    active: false,
    sectionRules: [],
    feeds: [{ kind: "feed", url: "https://www.forbes.com/entrepreneurs/feed/" }],
  },
  {
    domain: "gartner.com",
    name: "Gartner",
    covers: "newsroom: tendências e previsões com efeito em negócios",
    trust: 0,
    active: false,
    sectionRules: [],
    feeds: [{ kind: "feed", url: "https://www.gartner.com/en/newsroom/rss" }],
  },
];

// The active sources, in the shape a run reads them.
export const catalogSources = (): ActiveSource[] =>
  CATALOG.filter((source) => source.active).map(({ domain, name, trust, sectionRules, feeds }) => ({
    id: `catalog-${domain}`,
    domain,
    name,
    trust,
    sectionRules,
    feeds: feeds.map((feed) => ({ id: `catalog-${feed.url}`, ...feed })),
  }));

// The catalogue entry a link belongs to, by its domain and subdomains.
export const catalogSourceOf = (url: string | URL): CatalogSource | null => {
  if (!URL.canParse(url)) return null;
  const { hostname } = new URL(url);
  return CATALOG.find((source) => hostInDomain(hostname, source.domain)) ?? null;
};
