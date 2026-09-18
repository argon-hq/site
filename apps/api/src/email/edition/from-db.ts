import { Effect } from "effect";
import type { Article, Edition } from "../../generated/prisma/client";
import { EditionNotReadyError } from "../errors";
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

// `edition.date` is a DATE column: Prisma returns it as midnight UTC, which is the previous evening
// in São Paulo. Move it to noon UTC so the calendar day survives the time-zone conversion.
export function editionDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
}

function toItem(article: ArticleRow): Effect.Effect<EditionItem, EditionNotReadyError> {
  const { canonicalUrl, headline, body, category } = article;
  if (!headline || !body || !category) {
    return Effect.fail(new EditionNotReadyError({ reason: `article ${canonicalUrl} is not written yet` }));
  }
  return Effect.succeed({ category: CATEGORIES[category], headline, body, url: canonicalUrl });
}

// Highest score first; same score, newest first; then by URL so the order is stable.
function byRank(a: ArticleRow, b: ArticleRow): number {
  const score = Number(b.score ?? 0) - Number(a.score ?? 0);
  if (score !== 0) return score;
  const date = (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  if (date !== 0) return date;
  return a.canonicalUrl.localeCompare(b.canonicalUrl);
}

// Adapter from the database rows to the builder input. No I/O, no clock: a missing field is a
// typed failure, never an exception.
export function toEditionInput(
  edition: EditionRow,
  articles: ArticleRow[],
  context: EditionContext,
): Effect.Effect<EditionInput, EditionNotReadyError> {
  return Effect.gen(function* () {
    const day = edition.date.toISOString().slice(0, 10);
    if (!edition.title || !edition.subject) {
      return yield* new EditionNotReadyError({ reason: `edition ${day} has no title or subject` });
    }
    if (articles.length === 0) {
      return yield* new EditionNotReadyError({ reason: `edition ${day} has no articles` });
    }
    const items = yield* Effect.forEach([...articles].sort(byRank), toItem);
    return {
      ...context,
      date: editionDay(edition.date),
      title: edition.title,
      subject: edition.subject,
      items,
    };
  });
}
