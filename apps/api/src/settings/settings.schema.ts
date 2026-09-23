import { z } from "zod";
import { PROFILE } from "../pipeline/profile";

// Single source of truth for setting names, types and defaults.
// A key with a default needs no row in the table; keys without one are seeded by migration and adjusted per environment.
// The three that shape the edition take their default from the environment's profile, so lab and a
// development machine accept a weaker edition than production without anyone setting a row first. A
// row still wins: it is how an environment says something other than what the profile assumed.
// Secrets and infrastructure (DATABASE_URL, API keys) never live here: they come from the environment.
export const settingsSchema = z.object({
  // Operation
  sending_paused: z.boolean().default(false), // kill switch, re-read right before sending
  min_articles: z.number().int().min(1).default(PROFILE.minArticles),
  max_articles: z.number().int().min(1).default(PROFILE.maxArticles),
  score_cutoff: z.number().min(0).max(5).default(PROFILE.scoreCutoff),
  owner_emails: z.array(z.email()).default([]), // alerted when the pipeline fails
  policy_version: z.string().default(""), // recorded with each consent

  // Business identity: no sensible default in code
  sender: z.object({ name: z.string().min(1), address: z.email(), postalAddress: z.string().min(1) }),
  privacy_policy_url: z.url(),
  asset_base_url: z.url(), // absolute base of the e-mail images
  social: z.object({ site: z.url(), linkedin: z.url().optional(), instagram: z.url().optional(), youtube: z.url().optional() }),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;
export const settingKeys = Object.keys(settingsSchema.shape) as SettingKey[];

export function parseSettings(raw: Record<string, unknown>): Settings {
  const result = settingsSchema.safeParse(raw);
  if (result.success) return result.data;
  const keys = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? "?")))];
  throw new Error(`Invalid settings: ${keys.join(", ")}`);
}

export function parseSetting<K extends SettingKey>(key: K, value: unknown): Settings[K] {
  const result = settingsSchema.shape[key].safeParse(value);
  if (result.success) return result.data as Settings[K];
  throw new Error(`Invalid setting ${key}: ${result.error.issues.map((i) => i.message).join("; ")}`);
}
