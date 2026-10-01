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

export type SectionMatch = { tier: SectionTier; rule: string | null };

export function sectionOf(url: URL, categories: readonly string[], rules: readonly SectionRule[]): SectionMatch {
  const lowered = categories.map((c) => c.toLowerCase());
  const matches = rules.filter((rule) => {
    if (rule.match === "path") return url.pathname.startsWith(rule.pattern);
    if (rule.match === "host") return url.hostname.startsWith(rule.pattern.toLowerCase());
    return lowered.includes(rule.pattern.toLowerCase());
  });
  const chosen = matches.find((rule) => rule.tier === "discard") ?? matches[0];
  return chosen ? { tier: chosen.tier, rule: `${chosen.match}:${chosen.pattern}` } : { tier: "neutral", rule: null };
}
