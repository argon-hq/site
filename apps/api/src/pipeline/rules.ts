// Hard rules of the collection step. The agent judges inside these limits; it never changes them.

export const ALLOWED_DOMAINS = [
  "agenciabrasil.ebc.com.br",
  "valor.globo.com",
  "infomoney.com.br",
  "exame.com",
  "folha.uol.com.br",
  "forbes.com.br",
  "forbes.com",
  "gartner.com",
] as const;

export const RECENT_DAYS = 3; // how far back the agent sees what was already covered
export const MAX_TEXT_CHARS = 12_000;

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|ref$)/;

export function isAllowedDomain(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

// Same article, same key: no hash, no tracking parameters, no trailing slash.
export function canonicalize(url: string): string {
  const u = new URL(url);
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
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
