// The code's triage of the day's items: what a title and a section say about relevance to someone
// who runs a business, before any model reads anything. Versioned here, reviewed in the PR and
// recalibrated over real feeds with the run command of the next step. The section rules are per
// source (`source.ts`); everything else is here.
//
// Weights measured on 870 real items of 29/09/2026 (ARG-123) and tightened on 06/10/2026 over
// 599 candidates of the lab: trust stopped counting as a point (it was in 88 of the 96 fichas, a
// head start for two sources rather than a signal), the market routine and the election got their
// own rules, and the cutoff rose to 4. That run kept 14; a quiet day keeps more, the cap says how
// many at most.

// An item needs this much to become a ficha. At 3, with trust counting, 96 of the 456 groups of
// 06/10 passed and the third point was often the source's name; at 4, without it, 14.
export const CUTOFF = 4;

// The most fichas a run stores, best first: about an edition's week of reading, not a day's. No
// cap per source.
export const MAX_FICHAS = 20;

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
    // "resultado" alone is any outcome — an election's, a match's; here it is the company's.
    signal: "lexicon_company",
    points: 2,
    pattern:
      /\b(lucro|prejuizo|resultados? (trimestr\w*|anual|operacional|financeiro)|balanco|trimestre|investimentos?|aporte|demissao|demissoes|tarifas?|faturamento|recuperacao judicial)\b/,
  },
  { signal: "lexicon_off", points: -3, pattern: /\b(futebol|novela|celebridade|bbb|reality)\b/ },
  {
    // The day's moves, here or abroad — indices, currency, oil, rates going up or down — and the
    // executive appointments: the reader can see them anywhere.
    signal: "market_routine",
    points: -2,
    pattern:
      /\b(ibovespa|bolsas?|dolar|petroleo|juros? futuros?|tesouro direto|wall street|ny)\b.{0,50}\b(fecham?|abrem?|sobem?|caem?|cai|recuam?|avancam?|despencam?|disparam?|oscila\w*|em (alta|queda|baixa)|direcoes opostas|maior (alta|queda))\b|\b(fecham?|abrem?) em (alta|queda)\b|\b(elege|nomeia|nomeado|nomeada|assume|contrata)\b.{0,60}\b(ceo|cfo|presidente|diretor-presidente|diretora?|presidencia|diretoria|cargo)\b|\bnov[oa] (ceo|cfo|presidente|diretora?)\b/,
  },
  {
    // Election week: the vote itself is not business news. What it does to business keeps its
    // lexicon points and survives the discount.
    signal: "election",
    points: -1,
    pattern:
      /\b(eleic(ao|oes)|eleitor\w*|(1º|primeiro|2º|segundo) turno|candidat\w*|urnas?|lula|flavio|bolsonaro|tarcisio|haddad)\b/,
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
