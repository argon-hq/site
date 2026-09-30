import { createHash } from "node:crypto";

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|ref$)/;

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

// A redirector puts the real address after a marker in its own path: the Folha feed links to
// `redir.folha.com.br/redir/online/mercado/rss091/*https://www1.folha.uol.com.br/...`. The real URL
// is what carries the section, the domain the allowlist checks and the identity of the article, so
// it is taken out before anything else looks at the link. A link without the marker is itself.
export function unwrapRedirect(url: string): string {
  const marker = url.indexOf("*http");
  if (marker < 0) return url;
  const inner = url.slice(marker + 1);
  return URL.canParse(inner) ? inner : url;
}

// What `seen_url` keeps of a link: its canonical form hashed, never the link itself.
export function urlHash(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex");
}

// Whether a host is the domain or one of its subdomains: `www1.folha.uol.com.br` is Folha,
// `folha.uol.com.br.evil.test` is not.
export function hostInDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

// The domain a URL belongs to among the ones given, or null.
export function domainOf(url: string, domains: readonly string[]): string | null {
  const host = new URL(url).hostname;
  return domains.find((domain) => hostInDomain(host, domain)) ?? null;
}
