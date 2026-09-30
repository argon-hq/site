import { Data, Effect } from "effect";
import { dbEffect } from "../effect/db";
import type { PrismaClient } from "../generated/prisma/client";
import type { FeedKind } from "./source";
import { sectionRuleSchema, type ActiveSource, type SectionRule } from "./source";
import type { TextKind } from "./parse";
import type { Member } from "./group";
import type { Signal } from "./score";

export class IngestDbFailed extends Data.TaggedError("IngestDbFailed")<{ reason: string }> {}

// What one ingestion stores of a group: the ficha. Identity and decision, and the feed's text —
// the one thing that cannot be fetched again once the feed moves on.
export type Ficha = {
  canonicalUrl: string;
  sourceId: string | null; // null only for the mocked sources, which have no row
  sourceName: string;
  title: string;
  publishedAt: Date;
  origin: FeedKind;
  text: string | null;
  textKind: TextKind;
  codeScore: number;
  signals: Signal[];
  sources: number;
  members: Member[];
  signature: number[];
};

export type Known = { url: string; signature: number[] };
export type SourceHealth = { consecutiveFailures: number; alert: boolean };

// The database as an ingestion sees it. An interface, so the whole run can be exercised in a test
// and in a dry run without a database.
export type IngestStore = {
  activeSources(): Effect.Effect<ActiveSource[], IngestDbFailed>;
  seen(hashes: readonly string[]): Effect.Effect<Set<string>, IngestDbFailed>;
  markSeen(hashes: readonly string[], at: Date): Effect.Effect<void, IngestDbFailed>;
  known(since: Date): Effect.Effect<Known[], IngestDbFailed>;
  saveFichas(fichas: readonly Ficha[]): Effect.Effect<number, IngestDbFailed>;
  recordSource(sourceId: string, ok: boolean, at: Date): Effect.Effect<SourceHealth, IngestDbFailed>;
};

// After this many runs in a row with every address of a source failing, the owners hear of it —
// once, until a read succeeds again. The source stays active: a feed down for a morning is not a
// decision to drop it.
export const FAILURES_BEFORE_ALERT = 3;

// The longest text kept of a feed. Enough for any article; a runaway `content:encoded` is cut.
export const MAX_FEED_TEXT_CHARS = 12_000;

const db = dbEffect((reason) => new IngestDbFailed({ reason }));

export function prismaIngestStore(prisma: PrismaClient): IngestStore {
  return {
    activeSources: () =>
      db(() =>
        prisma.source.findMany({
          where: { active: true },
          orderBy: { domain: "asc" },
          select: {
            id: true,
            domain: true,
            name: true,
            trust: true,
            sectionRules: true,
            feeds: { select: { id: true, kind: true, url: true }, orderBy: { url: "asc" } },
          },
        }),
      ).pipe(Effect.map((rows) => rows.map((row) => ({ ...row, sectionRules: rulesOf(row.sectionRules) })))),

    seen: (hashes) =>
      hashes.length === 0
        ? Effect.succeed(new Set<string>())
        : db(() =>
            prisma.seenUrl.findMany({ where: { urlHash: { in: [...hashes] } }, select: { urlHash: true } }),
          ).pipe(Effect.map((rows) => new Set(rows.map((row) => row.urlHash)))),

    // Seen is refreshed, not only inserted: a link met again today stays out for three more days.
    markSeen: (hashes, at) =>
      hashes.length === 0
        ? Effect.void
        : db(() =>
            prisma.$transaction([
              prisma.seenUrl.updateMany({ where: { urlHash: { in: [...hashes] } }, data: { seenAt: at } }),
              prisma.seenUrl.createMany({
                data: hashes.map((urlHash) => ({ urlHash, seenAt: at })),
                skipDuplicates: true,
              }),
            ]),
          ).pipe(Effect.asVoid),

    known: (since) =>
      db(() =>
        prisma.article.findMany({
          where: { createdAt: { gte: since }, NOT: { titleSignature: { isEmpty: true } } },
          select: { canonicalUrl: true, titleSignature: true },
        }),
      ).pipe(Effect.map((rows) => rows.map((row) => ({ url: row.canonicalUrl, signature: row.titleSignature })))),

    // The canonical URL is unique: a ficha an earlier run of the day stored is skipped, not doubled.
    saveFichas: (fichas) =>
      fichas.length === 0
        ? Effect.succeed(0)
        : db(() =>
            prisma.article.createMany({
              data: fichas.map((f) => ({
                canonicalUrl: f.canonicalUrl,
                sourceId: f.sourceId,
                sourceName: f.sourceName,
                originalTitle: f.title,
                publishedAt: f.publishedAt,
                origin: f.origin,
                extractedText: f.text?.slice(0, MAX_FEED_TEXT_CHARS) ?? null,
                textKind: f.textKind,
                codeScore: f.codeScore,
                scoreDetails: { signals: f.signals, sources: f.sources },
                groupMembers: f.members,
                titleSignature: f.signature,
              })),
              skipDuplicates: true,
            }),
          ).pipe(Effect.map((result) => result.count)),

    recordSource: (sourceId, ok, at) =>
      ok
        ? db(() =>
            prisma.source.update({
              where: { id: sourceId },
              data: { lastOkAt: at, consecutiveFailures: 0, alertedAt: null },
            }),
          ).pipe(Effect.as({ consecutiveFailures: 0, alert: false }))
        : Effect.gen(function* () {
            const updated = yield* db(() =>
              prisma.source.update({
                where: { id: sourceId },
                data: { consecutiveFailures: { increment: 1 } },
                select: { consecutiveFailures: true },
              }),
            );
            if (updated.consecutiveFailures < FAILURES_BEFORE_ALERT)
              return { consecutiveFailures: updated.consecutiveFailures, alert: false };
            // Claimed in the database, so two runs that fail at once still send one alert.
            const claimed = yield* db(() =>
              prisma.source.updateMany({ where: { id: sourceId, alertedAt: null }, data: { alertedAt: at } }),
            );
            return { consecutiveFailures: updated.consecutiveFailures, alert: claimed.count === 1 };
          }),
  };
}

// The rules column is JSON written through the validated route; a row that does not parse is read
// as no rules rather than failing the run over one source.
function rulesOf(raw: unknown): SectionRule[] {
  const parsed = sectionRuleSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : [];
}
