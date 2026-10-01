// The code's triage of the day's items: what a title and a section say about relevance to someone
// who runs a business, before any model reads anything. Versioned here, reviewed in the PR and
// recalibrated over real feeds with the run command of the next step. The section rules are per
// source (`source.ts`); everything else is here.
//
// Starting weights measured on 870 real items of 29/09/2026 (ARG-123), to be recalibrated.

// An item needs this much to become a ficha. At 3, 166 of the 870 passed; at 4, 58, and good news
// fell (a record in formal jobs, WEG, Shopee).
export const CUTOFF = 3;

// Cost protection, not a filter: the most fichas a run stores, best first. No cap per source.
export const MAX_FICHAS = 200;

// Two titles at or above this estimated Jaccard similarity tell the same fact.
export const SAME_FACT = 0.5;

// How far back a fact already published or already stored as a ficha makes a new item a late copy.
export const REPUBLISH_DAYS = 3;

export type SectionTier = "discard" | "core" | "adjacent" | "neutral" | "peripheral";

export const SECTION_POINTS: Record<Exclude<SectionTier, "discard">, number> = {
  core: 2, // companies, legislation, business, small business
  adjacent: 1, // finance, economy, Brazil, technology, careers
  neutral: 0, // markets, and any section no rule names
  peripheral: -2, // politics, world
};

// Titles matched after `normalize`: lowercase, no accents.
type Rule = { signal: string; pattern: RegExp; points: number };

// Not news for this newsletter whatever the section says.
export const NOISE: readonly Omit<Rule, "points">[] = [
  { signal: "live", pattern: /\bao vivo\b/ },
  { signal: "quote", pattern: /\bcotacao\b/ },
  { signal: "lottery", pattern: /\b(loteria|mega-sena|lotofacil|quina|timemania)\b/ },
  { signal: "watch", pattern: /\bassista\b/ },
  { signal: "horoscope", pattern: /\bhoroscopo\b/ },
  // "Turno" alone is any story of election week ("a cinco dias do primeiro turno"); it is a poll
  // only next to one.
  {
    signal: "election_poll",
    pattern:
      /\b(pesquisa eleitoral|quaest|datafolha|ipec|intencao de voto)\b|\bpesquisas?\b.{0,80}\bturno\b|\bturno\b.{0,80}\bpesquisas?\b/,
  },
];

// Each rule counts once per title, however many of its words appear.
export const TITLE_RULES: readonly Rule[] = [
  {
    signal: "lexicon_core",
    points: 3,
    pattern:
      /\b(selic|copom|juros?|credito|inadimplencia|impostos?|tributos?|tributaria|simples nacional|meis?|pmes?|pequenas empresas|empreendedor\w*|startups?|ipo|fusao|fusoes|aquisicao|regulacao|regulamentacao|reforma)\b/,
  },
  {
    signal: "lexicon_company",
    points: 2,
    pattern:
      /\b(lucro|prejuizo|resultado|balanco|trimestre|investimentos?|aporte|demissao|demissoes|tarifas?|faturamento|recuperacao judicial)\b/,
  },
  { signal: "lexicon_off", points: -3, pattern: /\b(futebol|novela|celebridade|bbb|reality)\b/ },
  {
    signal: "market_routine",
    points: -2,
    pattern:
      /\b(ibovespa|dolar|petroleo)\b.{0,40}\b(fecha|abre|sobe|cai|recua|avanca)\b|\b(fecha|abre) em (alta|queda)\b|\b(elege|nomeia|nomeado|nomeada|assume|contrata)\b.{0,60}\b(ceo|cfo|presidente|diretor-presidente|diretora?|presidencia|diretoria|cargo)\b|\bnov[oa] (ceo|cfo|presidente|diretora?)\b/,
  },
  { signal: "hard_data", points: 1, pattern: /\d+([.,]\d+)?\s?%|r\$|us\$|\bmilh(ao|oes)\b|\bbilh(ao|oes)\b/ },
  { signal: "question", points: -1, pattern: /\?\s*$/ },
];

// Abroad without Brazil: a foreign place or authority in the title and nothing that brings it here.
export const FOREIGN = {
  signal: "abroad_without_brazil",
  points: -2,
  foreign:
    /\b(eua|estados unidos|china|chines|europa|europeu|ue|japao|alemanha|franca|reino unido|argentina|espanha|australia|india|russia|ucrania|israel|mexico|canada|italia|coreia|trump|fed|bce)\b/,
  brazil:
    /\b(brasil\w*|bc|selic|copom|ibovespa|b3|petrobras|vale|embraer|itau|bradesco|governo|lula|haddad|congresso|senado|camara|stf|receita federal|sao paulo)\b/,
};

// The same fact in more outlets is a sign of importance: one point per extra source, up to three.
export const CROSS_COVERAGE = { signal: "cross_coverage", perSource: 1, max: 3 };

export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}
