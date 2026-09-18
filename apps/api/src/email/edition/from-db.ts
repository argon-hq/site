import type { Article, Edition } from "../../generated/prisma/client";
import { CATEGORIES } from "../../mastra/schemas/edition";
import type { Settings } from "../../settings/settings.schema";
import type { EditionInput, EditionItem } from "../types";

// Rows the adapter reads. Structural on purpose: tests build them without a database.
export type EditionRow = Pick<Edition, "date" | "title" | "subject">;
export type ArticleRow = Pick<Article, "canonicalUrl" | "headline" | "body" | "category" | "score" | "publishedAt">;

// What the rows do not carry. Sender, policy, assets and social links come from the settings;
// `unsubscribeUrl` is per subscriber, so the caller builds one context per recipient.
export type EditionContext = Omit<EditionInput, "date" | "title" | "subject" | "items">;

export type IdentitySettings = Pick<Settings, "sender" | "privacy_policy_url" | "asset_base_url" | "social">;

// The settings are loaded once per run; only the unsubscribe URL changes between recipients.
export function editionContext(settings: IdentitySettings, unsubscribeUrl: string): EditionContext {
  return {
    sender: settings.sender,
    social: settings.social,
    privacyPolicyUrl: settings.privacy_policy_url,
    assetBaseUrl: settings.asset_base_url,
    unsubscribeUrl,
  };
}

// The pipeline calls the builder only after the writer filled every field; a null here is a bug upstream.
export class EditionNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditionNotReadyError";
  }
}

// `edition.date` is a DATE column: Prisma returns it as midnight UTC, which is the previous evening
// in São Paulo. Move it to noon UTC so the calendar day survives the time-zone conversion.
export function editionDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
}

function toItem(article: ArticleRow): EditionItem {
  const { canonicalUrl, headline, body, category } = article;
  if (!headline || !body || !category) throw new EditionNotReadyError(`article ${canonicalUrl} is not written yet`);
  return { category: CATEGORIES[category], headline, body, url: canonicalUrl };
}

// Highest score first; same score, newest first; then by URL so the order is stable.
function byRank(a: ArticleRow, b: ArticleRow): number {
  const score = Number(b.score ?? 0) - Number(a.score ?? 0);
  if (score !== 0) return score;
  const date = (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  if (date !== 0) return date;
  return a.canonicalUrl.localeCompare(b.canonicalUrl);
}

// Adapter from the database rows to the builder input. Pure: no I/O, no clock.
export function toEditionInput(edition: EditionRow, articles: ArticleRow[], context: EditionContext): EditionInput {
  const day = edition.date.toISOString().slice(0, 10);
  if (!edition.title || !edition.subject) throw new EditionNotReadyError(`edition ${day} has no title or subject`);
  if (articles.length === 0) throw new EditionNotReadyError(`edition ${day} has no articles`);
  return {
    ...context,
    date: editionDay(edition.date),
    title: edition.title,
    subject: edition.subject,
    items: [...articles].sort(byRank).map(toItem),
  };
}
