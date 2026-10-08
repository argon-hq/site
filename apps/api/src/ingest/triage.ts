// The code's triage of the day's items: what a title and a section say about relevance to someone
// who runs a business, before any model reads anything. Versioned here, reviewed in the PR and
// recalibrated over real feeds with `pnpm ingest:run --ignore-seen`. The section rules are per
// source (`source.ts`); everything else is here.
//
// Weights measured on 870 real items of 29/09/2026 (ARG-123), tightened on 06/10/2026 over 599
// candidates of the lab (trust no longer a point, market routine and election rules, cutoff 4), and
// on 08/10/2026 taught the newsletter's focus (ARG-124): business and technology are the core, the
// market only counts when the title names its effect on a business, and personal finance is noise.
// The model's triage comes next and refines this list; it never has to undo it, so the code refuses
// what is clearly out and ranks the rest — it does not pretend to be the verdict.

// An item needs this much to become a ficha. At 3, with trust counting, 96 of the 456 groups of
// 06/10 passed and the third point was often the source's name; at 4, without it, 14.
export const CUTOFF = 4;

// The most fichas a run stores, best first: what the model's triage reads, and the day's cost. Over
// it, the lowest scores are the ones left out. No cap per source.
export const MAX_FICHAS = 20;

// Two titles at or above this estimated Jaccard similarity tell the same fact.
export const SAME_FACT = 0.5;

// How far back a fact already published or already stored as a ficha makes a new item a late copy.
export const REPUBLISH_DAYS = 3;

// The classes of the focus, shared by the section rules in the `source` table and the lexicon
// below, so the two never disagree: `core` is business and technology; `market` is rates, prices
// and indices, worth nothing on their own; `adjacent` is what touches business sideways (careers,
// the country); `peripheral` is politics and the world; `neutral` is a section no rule names.
export type SectionTier = "discard" | "core" | "adjacent" | "market" | "neutral" | "peripheral";

export const SECTION_POINTS: Record<Exclude<SectionTier, "discard">, number> = {
  core: 2, // companies, business, small business, legislation, technology
  adjacent: 1, // careers, the country
  market: 0, // finance, economy, markets: the title has to name a business effect to score
  neutral: 0,
  peripheral: -2, // politics, world
};

// Titles matched after `normalize`: lowercase, no accents. A rule with `requires` scores only when
// both patterns match: the market lexicon needs a business effect next to it.
type Rule = { signal: string; pattern: RegExp; points: number; requires?: RegExp };

// Not news for this newsletter whatever the section says.
export const NOISE: readonly Omit<Rule, "points">[] = [
  { signal: "live", pattern: /\bao vivo\b/ },
  { signal: "quote", pattern: /\bcotacao\b/ },
  { signal: "lottery", pattern: /\b(loteria|mega-sena|lotofacil|quina|timemania)\b/ },
  { signal: "watch", pattern: /\bassista\b/ },
  { signal: "horoscope", pattern: /\bhoroscopo\b/ },
  // Personal finance: what an investor should do with their money is not what a business decides.
  {
    signal: "personal_finance",
    pattern: /\b(investidor(es|a|as)?|tesouro direto|renda fixa|ipca\+|cdbs?|lcis?|lcas?|como investir|onde investir|vale a pena investir|carteira de investimentos?)\b/,
  },
  // "Turno" alone is any story of election week ("a cinco dias do primeiro turno"); it is a poll
  // only next to one.
  {
    signal: "election_poll",
    pattern:
      /\b(pesquisa eleitoral|quaest|datafolha|ipec|intencao de voto)\b|\bpesquisas?\b.{0,80}\bturno\b|\bturno\b.{0,80}\bpesquisas?\b/,
  },
];

// What makes a market or macro story a business story: the title names who pays or what changes.
const BUSINESS_EFFECT =
  /\b(credito|financiamentos?|emprestimos?|custos?|repasses?|empresas?|empresarial|contratos?|reajustes?|pmes?|pequenas empresas|consignado|parcelamentos?|folha de pagamento|importador\w*|exportador\w*|producao|industria|varejo|comercio|setor)\b/;

// Each rule counts once per title, however many of its words appear.
export const TITLE_RULES: readonly Rule[] = [
  {
    // Business: the company, the entrepreneur, the rule that binds them, the money they borrow.
    signal: "lexicon_business",
    points: 3,
    pattern:
      /\b(credito|inadimplencia|impostos?|tributos?|tributaria|simples nacional|meis?|pmes?|pequenas empresas|empreendedor\w*|startups?|ipo|fusao|fusoes|aquisicao|regulacao|regulamentacao|reforma|cade|licitacao|concessao|franquias?)\b/,
  },
  {
    // Technology applied to business: the tool, the platform, the rule about them.
    signal: "lexicon_technology",
    points: 3,
    pattern:
      /\b(ia|inteligencia artificial|software|fintechs?|plataformas?|aplicativos?|apps?|dados|nuvem|cloud|automacao|ciberseguranca|cibernetic\w*|pix|open finance|e-commerce|marketplace|algoritmos?|chatbots?|agentes? de ia)\b/,
  },
  {
    // Rates, prices and indices score only next to the business they move; alone they are routine.
    signal: "market_effect",
    points: 3,
    pattern: /\b(selic|copom|juros?|dolar|cambio|inflacao|ipca|ibovespa|bolsa|petroleo|commodities)\b/,
    requires: BUSINESS_EFFECT,
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
      /\b(ibovespa|bolsas?|dolar|petroleo|juros? futuros?|wall street|ny)\b.{0,50}\b(fecham?|abrem?|sobem?|caem?|cai|recuam?|avancam?|despencam?|disparam?|oscila\w*|em (alta|queda|baixa)|direcoes opostas|maior (alta|queda)|recorde)\b|\b(fecham?|abrem?) em (alta|queda)\b|\b(elege|nomeia|nomeado|nomeada|assume|contrata)\b.{0,60}\b(ceo|cfo|presidente|diretor-presidente|diretora?|presidencia|diretoria|cargo)\b|\bnov[oa] (ceo|cfo|presidente|diretora?)\b/,
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
