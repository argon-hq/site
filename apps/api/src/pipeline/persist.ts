import type { LoggerService } from "@nestjs/common";
import { Data, Effect, Match } from "effect";
import type { PrismaClient } from "../generated/prisma/client";
import type { ExtractedArticle } from "../mastra/schemas/article";
import { fetchArticle, type FetchFailed, type PageUnreadable } from "../mastra/tools/read-page";
import type { Candidate } from "./collect.schema";
import { canonicalize, isAllowedDomain } from "./rules";

export type Outcome =
  | { outcome: "saved"; url: string; publishedAt: string | null }
  | { outcome: "duplicate"; url: string }
  | { outcome: "below_cutoff"; url: string }
  | { outcome: "rejected"; url: string; reason: string };

export type PersistContext = { prisma: PrismaClient; since: Date; cutoff: number; maxTextChars: number; logger: LoggerService };
export type ReadPage = (url: string) => Effect.Effect<ExtractedArticle, FetchFailed | PageUnreadable>;

class Rejected extends Data.TaggedError("Rejected")<{ url: string; reason: string }> {}
class Duplicate extends Data.TaggedError("Duplicate")<{ url: string }> {}
class BelowCutoff extends Data.TaggedError("BelowCutoff")<{ url: string }> {}
export class DbFailed extends Data.TaggedError("DbFailed")<{ url: string; reason: string }> {}

const db = <A>(url: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => new DbFailed({ url, reason: String(error) }) });

// Every evaluated link is remembered, kept or not, so the next run skips it.
const markSeen = (prisma: PrismaClient, url: string) =>
  db(url, () => prisma.seenUrl.upsert({ where: { url }, create: { url }, update: { seenAt: new Date() } }));

const findArticle = (prisma: PrismaClient, url: string) =>
  db(url, () => prisma.article.findUnique({ where: { canonicalUrl: url }, select: { id: true } }));

// The agent judged; the code decides what is stored. Allowlist, window and cutoff are enforced here.
const persist = (candidate: Candidate, ctx: PersistContext, read: ReadPage) =>
  Effect.gen(function* () {
    const url = canonicalize(candidate.url);
    if (!isAllowedDomain(url)) return yield* new Rejected({ url, reason: "domain not allowed" });

    yield* markSeen(ctx.prisma, url);
    if (candidate.score < ctx.cutoff) return yield* new BelowCutoff({ url });

    const existing = yield* findArticle(ctx.prisma, url);
    if (existing) return yield* new Duplicate({ url });

    // Text, date and identity come from the page itself, not from the agent's account of it.
    const page = yield* read(url).pipe(Effect.mapError((e) => new Rejected({ url, reason: `${e._tag}: ${e.reason}` })));

    // The page's own canonical URL is the identity, so the same article reached by two links
    // collapses into one row instead of two.
    const canonical = canonicalize(page.canonicalUrl);
    if (canonical !== url) {
      if (!isAllowedDomain(canonical)) return yield* new Rejected({ url, reason: "canonical url outside the allowlist" });
      yield* markSeen(ctx.prisma, canonical);
      const twin = yield* findArticle(ctx.prisma, canonical);
      if (twin) return yield* new Duplicate({ url: canonical });
    }

    const publishedAt = page.publishedAt ? new Date(page.publishedAt) : null;
    if (publishedAt && Number.isNaN(publishedAt.getTime())) return yield* new Rejected({ url: canonical, reason: "invalid publishedAt" });
    if (publishedAt && publishedAt < ctx.since) return yield* new Rejected({ url: canonical, reason: "outside window" });

    yield* db(canonical, () =>
      ctx.prisma.article.create({
        data: {
          canonicalUrl: canonical,
          sourceName: candidate.sourceName,
          originalTitle: page.originalTitle || candidate.title,
          extractedText: page.extractedText.slice(0, ctx.maxTextChars),
          publishedAt,
          score: candidate.score,
          scoreDetails: { rationale: candidate.rationale },
        },
      }),
    );
    return { outcome: "saved", url: canonical, publishedAt: publishedAt?.toISOString() ?? null } satisfies Outcome;
  });

// Expected results become data; only database failures stay errors.
export const persistCandidate = (candidate: Candidate, ctx: PersistContext, read: ReadPage = fetchArticle): Effect.Effect<Outcome, DbFailed> =>
  persist(candidate, ctx, read).pipe(
    Effect.catchTags({
      Rejected: (e) => Effect.succeed({ outcome: "rejected", url: e.url, reason: e.reason } satisfies Outcome),
      Duplicate: (e) => Effect.succeed({ outcome: "duplicate", url: e.url } satisfies Outcome),
      BelowCutoff: (e) => Effect.succeed({ outcome: "below_cutoff", url: e.url } satisfies Outcome),
    }),
    Effect.tap((o) =>
      Effect.sync(() =>
        Match.value(o).pipe(
          Match.when({ outcome: "saved" }, (s) => ctx.logger.log({ msg: "article saved", url: s.url, score: candidate.score })),
          Match.when({ outcome: "rejected" }, (r) => ctx.logger.warn({ msg: "article rejected", url: r.url, reason: r.reason })),
          Match.orElse((other) => ctx.logger.log({ msg: `article ${other.outcome}`, url: other.url })),
        ),
      ),
    ),
  );
