// Hard rules of the edition steps. The agent judges inside these limits; it never changes them,
// and they are the same in every environment — what changes with the environment is in `profile.ts`.

// The newsletter's sources. `domain` is the allowlist the search and the persistence enforce;
// `name` and `covers` go into the step prompt, so what the agent reads and what the code accepts
// can never drift apart.
export const SOURCES = [
  { domain: "agenciabrasil.ebc.com.br", name: "Agência Brasil", covers: "indicadores, medidas do governo com efeito em negócios" },
  { domain: "valor.globo.com", name: "Valor Econômico", covers: "empresas, negócios, finanças" },
  { domain: "infomoney.com.br", name: "InfoMoney", covers: "negócios, mercado, empreendedorismo" },
  { domain: "exame.com", name: "Exame", covers: "negócios, PME, gestão" },
  { domain: "folha.uol.com.br", name: "Folha Mercado", covers: "mercado, empresas" },
  { domain: "forbes.com.br", name: "Forbes Brasil", covers: "negócios, empreendedorismo" },
  { domain: "forbes.com", name: "Forbes", covers: "entrepreneurs, small business, leadership" },
  { domain: "gartner.com", name: "Gartner", covers: "newsroom: tendências e previsões com efeito em negócios" },
] as const;

export const ALLOWED_DOMAINS = SOURCES.map((source) => source.domain);

export const RECENT_DAYS = 3; // how far back the agent sees what was already covered

// How much a run may search, how long its text may be and how many turns it gets are not rules:
// they are what an environment is willing to pay. They live in `profile.ts`.

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|ref$)/;

export function isAllowedDomain(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

// Same article, same key: lowercase host without `www.`, no hash, no tracking parameters, the
// remaining query in a stable order and no trailing slash.
export function canonicalize(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.toString();
}

// 24 hours; 48 on Mondays (São Paulo time) to cover the weekend.
export function windowHours(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Sao_Paulo" }).format(date);
  return weekday === "Mon" ? 48 : 24;
}

export function windowStart(date: Date): Date {
  return new Date(date.getTime() - windowHours(date) * 60 * 60 * 1000);
}

// The edition's calendar day in São Paulo, in the shape the DATE column stores: midnight UTC.
export function editionDate(date: Date): Date {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);
  return new Date(`${day}T00:00:00Z`);
}
