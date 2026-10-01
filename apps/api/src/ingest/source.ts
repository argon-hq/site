import { z } from "zod";

// How a source says where its sections are: a path prefix of the article URL (`/empresas/`), the
// start of its host (`aovivo.`, Folha's live blogs, whose path looks like any other section), or a
// category of the feed item (`Forbes Money`). The triage, in the next step, reads them: a `discard`
// match drops the item whatever else matches; otherwise the first match gives the tier.
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
