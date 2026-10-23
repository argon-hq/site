import { domainOf } from "./url";

// The domains of the active sources: what `read_page` may open and what an ingestion may store.
// The `source` table is where they live; this is the copy a run works with. It is refreshed when
// the API boots and at the start of every ingestion, so a source turned off leaves the allowlist on
// the next run. Empty until then, which refuses everything: an allowlist that failed to load must
// not open the web.
let domains: readonly string[] = [];

export function setAllowedDomains(next: readonly string[]): void {
  domains = [...new Set(next.map((d) => d.toLowerCase()))];
}

export function allowedDomains(): readonly string[] {
  return domains;
}

// A link on one of the active sources, by its domain and subdomains. A string that is no URL is not
// allowed.
export function isAllowedDomain(url: string | URL): boolean {
  return domainOf(url, domains) !== null;
}
