import { isIP } from "node:net";
import { z } from "zod";
import { feedKindSchema, sectionRuleSchema } from "./source";
import { hostInDomain } from "./url";

// Every write to the sources goes through these. The domain is the allowlist of what the agent may
// read and what an ingestion may store, so it is checked like one: a name, never an address, and
// every feed of a source on that name.

export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "a domain like valor.globo.com, without scheme or path")
  .refine((domain) => isIP(domain) === 0, "a domain, not an IP address");

export const feedUrlSchema = z
  .url()
  .refine((url) => new URL(url).protocol === "https:", "https only")
  .refine((url) => isIP(new URL(url).hostname.replace(/^\[|\]$/g, "")) === 0, "a name, not an IP address");

export const feedInputSchema = z.object({ kind: feedKindSchema, url: feedUrlSchema });

const trust = z.union([z.literal(0), z.literal(1)]);

export const sourceCreateSchema = z
  .object({
    domain: domainSchema,
    name: z.string().trim().min(1).max(120),
    covers: z.string().trim().min(1).max(300),
    trust: trust.default(0),
    active: z.boolean().default(true),
    sectionRules: z.array(sectionRuleSchema).max(100).default([]),
    feeds: z.array(feedInputSchema).max(20).default([]),
  })
  .superRefine((source, ctx) => {
    source.feeds.forEach((feed, index) => {
      if (!feedInDomain(feed.url, source.domain))
        ctx.addIssue({ code: "custom", path: ["feeds", index, "url"], message: `not on ${source.domain}` });
    });
  });

export const sourcePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    covers: z.string().trim().min(1).max(300),
    trust,
    active: z.boolean(),
    sectionRules: z.array(sectionRuleSchema).max(100),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "nothing to change");

export type SourceCreate = z.infer<typeof sourceCreateSchema>;
export type SourcePatch = z.infer<typeof sourcePatchSchema>;
export type FeedInput = z.infer<typeof feedInputSchema>;

export function feedInDomain(url: string, domain: string): boolean {
  return URL.canParse(url) && hostInDomain(new URL(url).hostname, domain);
}
