import { z } from "zod";
import type { SectionTier } from "./triage";

// How a source says where its sections are: a path prefix of the article URL (`/empresas/`), the
// start of its host (`aovivo.`, Folha's live blogs, whose path looks like any other section), or a
// category of the feed item (`Forbes Money`). A `discard` match drops the item whatever else
// matches; otherwise the first match gives the tier, and no match is `neutral`.
export const sectionRuleSchema = z.object({
  match: z.enum(["path", "host", "category"]),
  pattern: z.string().trim().min(1).max(200),
  tier: z.enum(["discard", "core", "adjacent", "neutral", "peripheral"]),
});
export type SectionRule = z.infer<typeof sectionRuleSchema>;

export const feedKindSchema = z.enum(["feed", "news_sitemap", "search"]);
export type FeedKind = z.infer<typeof feedKindSchema>;

export type SourceFeed = { id: string; kind: FeedKind; url: string };

// A source as a run sees it: read once at the start, so a change in the middle of a run only
// counts from the next one.
export type ActiveSource = {
  id: string;
  domain: string;
  name: string;
  trust: number;
  sectionRules: readonly SectionRule[];
  feeds: readonly SourceFeed[];
};

// The tier an item's section puts it in, and the rule that said so (`path:/empresas/`), or none.
export type SectionMatch = { tier: SectionTier; rule: string | null };

const NO_MATCH: SectionMatch = { tier: "neutral", rule: null };

// Patterns and what they are matched against compare in lowercase: a feed that writes `/Empresas/`
// or `Forbes Money` means the same section.
export function sectionOf(url: URL, categories: readonly string[], rules: readonly SectionRule[]): SectionMatch {
  const path = url.pathname.toLowerCase();
  const host = url.hostname.toLowerCase();
  const lowered = new Set(categories.map((category) => category.toLowerCase()));
  const matches = rules.filter((rule) => {
    const pattern = rule.pattern.toLowerCase();
    if (rule.match === "path") return path.startsWith(pattern);
    if (rule.match === "host") return host.startsWith(pattern);
    return lowered.has(pattern);
  });
  const chosen = matches.find((rule) => rule.tier === "discard") ?? matches[0];
  return chosen ? { tier: chosen.tier, rule: `${chosen.match}:${chosen.pattern}` } : NO_MATCH;
}
