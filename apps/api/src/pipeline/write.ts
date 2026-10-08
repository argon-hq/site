import type { LoggerService } from "@nestjs/common";
import { Data, Effect, Ref } from "effect";
import { z } from "zod";
import { dbEffect } from "../effect/db";
import { CONFLICT, type Failure } from "../effect/failure";
import type { PrismaClient } from "../generated/prisma/client";
import type { TextKind } from "../generated/prisma/enums";
import { twoAttempts } from "../mastra/attempts";
import type { ExtractedArticle } from "../mastra/schemas/article";
import type { Verdict } from "../mastra/schemas/triage";
import {
  BODY_MIN,
  BODY_TARGET,
  CATEGORIES,
  HEADLINE_MAX,
  SUBJECT_MAX,
  TITLE_MAX,
  type EditionHeader,
  type WrittenItem,
} from "../mastra/schemas/edition";

// Another outlet that told the same fact, as the ingestion stored it on the ficha: where the text
// comes from when the representative's page is closed.
export const memberSchema = z.object({
  url: z.url(),
  sourceName: z.string(),
  title: z.string(),
  textKind: z.enum(["full", "summary", "none"]),
});
export type Member = z.infer<typeof memberSchema>;

// Where the text an article is written from came from: the ficha's own feed or page, or a member's
// page. The edition still links the ficha; the prompt names the outlet the facts were read in.
export type TextOrigin = { url: string; sourceName: string; via: "feed" | "page" | "member" };

// One article the step may write: a ficha of the ingestion, not yet in another edition, with the
// text it will be written from.
export type Candidate = {
  id: string;
  canonicalUrl: string;
  sourceName: string;
  originalTitle: string;
  extractedText: string;
  codeScore: number;
  // The model's triage, once it has spoken; null before it, and in a mocked run folded from the code.
  verdict: Verdict | null;
  textFrom: TextOrigin;
};

// A ficha as stored: the feed's text, if any, what kind of text it is, and the group's members.
export type Ficha = Omit<Candidate, "extractedText" | "textFrom"> & {
  extractedText: string | null;
  textKind: TextKind | null;
  members: Member[];
};

export type ReadError = { _tag: string; reason: string };
export type ReadPage = (url: string) => Effect.Effect<ExtractedArticle, ReadError>;

// The run's reads are counted: past `max` the page is not opened and the read fails like a closed
// one, so the chain falls through to the feed's text. `spent` says how many were used.
export const withReadBudget = (
  read: ReadPage,
  max: number,
): Effect.Effect<{ read: ReadPage; spent: Effect.Effect<number> }> =>
  Ref.make(0).pipe(
    Effect.map((used) => ({
      read: (url) =>
        Ref.modify(used, (n) => [n < max, n < max ? n + 1 : n] as const).pipe(
          Effect.flatMap((allowed) =>
            allowed
              ? read(url)
              : Effect.fail({ _tag: "ReadBudgetSpent", reason: `the run's budget of ${max} page reads is spent` }),
          ),
        ),
      spent: Ref.get(used),
    })),
  );

export type ItemResult =
  | { outcome: "written"; id: string; url: string; item: WrittenItem; score: number; usage: unknown }
  | { outcome: "rejected"; url: string; reason: string };

export type WrittenResult = Extract<ItemResult, { outcome: "written" }>;
export type Written = { id: string; item: WrittenItem; score: number };

// A generation that already carries its reason, so the second attempt can quote it.
export class ItemFailed extends Data.TaggedError("ItemFailed")<{ reason: string }> {}
export class WriteDbFailed extends Data.TaggedError("WriteDbFailed")<Failure> {}

export type Generate<A> = (prompt: string) => Effect.Effect<{ object: A; usage?: unknown }, ItemFailed>;

const db = dbEffect((reason) => new WriteDbFailed({ reason }));

// Today's edition, created on the first run of the day. Running the step again reuses the row; one
// already on its way out is never rewritten, and the database freezes a sent one anyway.
// `alreadyWritten` says whether an earlier run of the day left a complete edition here, which
// decides what a later, thinner run is allowed to do to it.
export const openEdition = (prisma: PrismaClient, date: Date) =>
  db(() =>
    prisma.edition.upsert({
      where: { date },
      create: { date },
      update: {},
      select: { id: true, status: true, title: true, _count: { select: { articles: true } } },
    }),
  ).pipe(
    Effect.filterOrFail(
      (edition) => edition.status !== "sending" && edition.status !== "sent",
      (edition) =>
        new WriteDbFailed({
          reason: `edition ${date.toISOString().slice(0, 10)} is already ${edition.status}`,
          status: CONFLICT,
        }),
    ),
    Effect.map((edition) => ({
      id: edition.id,
      status: edition.status,
      alreadyWritten: edition.title !== null && edition._count.articles > 0,
    })),
  );

// What a run is allowed to do when it wrote fewer items than the minimum. An edition an earlier run
// already completed is kept, not downgraded: a thin run must never destroy a good edition, and a
// `skipped` edition that still carries a headline and articles would lie about its own state.
export function belowMinimum(p: {
  written: number;
  min: number;
  alreadyWritten: boolean;
}): "enough" | "skip" | "keep_previous" {
  if (p.written >= p.min) return "enough";
  return p.alreadyWritten ? "keep_previous" : "skip";
}

// The day's fichas, best code score first, up to `take`: unattached or already part of this
// edition, so a second run rewrites the same set. The model's triage reads them all; the pool the
// writing works from is cut after it (see `shortlist`).
export const selectFichas = (
  prisma: PrismaClient,
  p: { editionId: string; since: Date; take: number },
): Effect.Effect<Ficha[], WriteDbFailed> =>
  db(() =>
    prisma.article.findMany({
      where: {
        OR: [{ editionId: null }, { editionId: p.editionId }],
        createdAt: { gte: p.since },
        codeScore: { not: null },
      },
      orderBy: [{ codeScore: "desc" }, { publishedAt: "desc" }],
      take: p.take,
      select: {
        id: true,
        canonicalUrl: true,
        sourceName: true,
        originalTitle: true,
        extractedText: true,
        textKind: true,
        codeScore: true,
        groupMembers: true,
      },
    }),
  ).pipe(
    Effect.map((rows) =>
      rows.map(({ groupMembers, ...row }) => ({
        ...row,
        codeScore: row.codeScore ?? 0,
        members: membersOf(groupMembers),
        verdict: null,
      })),
    ),
  );

// The members column is JSON the ingestion wrote; a row that does not parse is a ficha with no
// members, not a failed step.
export function membersOf(raw: unknown): Member[] {
  const parsed = memberSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : [];
}

// The text a ficha is written from: the feed's own when it was the whole article; else the page,
// and when that one is closed or has no readable text, the next member of the group, in order; else
// the feed's lead. A ficha with none of them is left out. The run's read budget ends the chain
// early: past it, no page is opened and the feed's lead is all there is.
export const hydrate = (ficha: Ficha, read: ReadPage, logger: LoggerService): Effect.Effect<Candidate | null> =>
  Effect.gen(function* () {
    const { members, textKind, ...rest } = ficha;
    const withText = (extractedText: string, textFrom: TextOrigin): Candidate => ({ ...rest, extractedText, textFrom });
    const own: TextOrigin = { url: ficha.canonicalUrl, sourceName: ficha.sourceName, via: "page" };
    if (textKind === "full" && ficha.extractedText) return withText(ficha.extractedText, { ...own, via: "feed" });

    const pages: TextOrigin[] = [
      own,
      ...members.map((m): TextOrigin => ({ url: m.url, sourceName: m.sourceName, via: "member" })),
    ];
    for (const origin of pages) {
      const page = yield* Effect.either(read(origin.url));
      if (page._tag === "Right") {
        if (origin.via === "member") {
          logger.log({ msg: "text read from a member", url: ficha.canonicalUrl, from: origin.url });
        }
        return withText(page.right.extractedText, origin);
      }
      const spent = page.left._tag === "ReadBudgetSpent";
      const last = spent || origin === pages.at(-1);
      logger.warn({
        msg: "page read failed",
        url: ficha.canonicalUrl,
        page: origin.url,
        reason: `${page.left._tag}: ${page.left.reason}`,
        fallback: last ? (ficha.extractedText ? "feed text" : "none") : "next member",
      });
      if (spent) break;
    }
    return ficha.extractedText ? withText(ficha.extractedText, { ...own, via: "feed" }) : null;
  });

// The edition from the pool, best first. Each round takes as many fichas as the edition still lacks,
// gives them their text and writes them; a ficha with no text, or whose item is rejected twice,
// leaves its place to the next one. It ends when the edition is full or the pool is empty, so a
// thin day costs no more generations than it has fichas.
export const fillEdition = (
  fichas: readonly Ficha[],
  max: number,
  toCandidate: (ficha: Ficha) => Effect.Effect<Candidate | null>,
  write: (candidate: Candidate) => Effect.Effect<ItemResult>,
): Effect.Effect<{ items: ItemResult[]; tried: number }> =>
  Effect.gen(function* () {
    const items: ItemResult[] = [];
    const missing = () => max - items.filter((item) => item.outcome === "written").length;
    let next = 0;
    while (next < fichas.length && missing() > 0) {
      const round = fichas.slice(next, next + missing());
      next += round.length;
      const candidates = yield* Effect.forEach(round, toCandidate, { concurrency: 3 });
      const written = yield* Effect.forEach(
        candidates.filter((candidate): candidate is Candidate => candidate !== null),
        write,
        { concurrency: 3 },
      );
      items.push(...written);
    }
    return { items, tried: next };
  });

// Limits come from the code into the prompt; the skill holds the craft.
export function itemPrompt(article: Candidate): string {
  return [
    'Carregue a skill "write" com a ferramenta skill e siga o processo dela.',
    "Escreva o item desta notícia, e só dela.",
    `Categorias: ${Object.keys(CATEGORIES).join(", ")}.`,
    `Manchete: até ${HEADLINE_MAX} caracteres.`,
    `Corpo: de ${BODY_MIN} a ${BODY_TARGET} caracteres, contando espaços.`,
    `Fonte: ${article.textFrom.sourceName}`,
    `Título original: ${article.originalTitle}`,
    "--- notícia ---",
    article.extractedText,
    "--- fim ---",
  ].join("\n");
}

export function headerPrompt(items: WrittenItem[]): string {
  return [
    'Carregue a skill "write" com a ferramenta skill e siga o processo dela.',
    "Escreva o título e o assunto do e-mail da edição de hoje. A primeira notícia abaixo é a principal do dia.",
    `Título: até ${TITLE_MAX} caracteres, contando espaços.`,
    `Assunto: até ${SUBJECT_MAX} caracteres, contando espaços.`,
    "--- notícias, na ordem da edição ---",
    ...items.map((item, index) => `${index + 1}. [${CATEGORIES[item.category]}] ${item.headline}\n${item.body}`),
    "--- fim ---",
  ].join("\n");
}

// Two attempts per article, as the architecture decided. Failing twice is not a step failure: the
// article leaves the edition and the others go on.
export const writeItem = (
  article: Candidate,
  generate: Generate<WrittenItem>,
  logger: LoggerService,
): Effect.Effect<ItemResult> =>
  twoAttempts(itemPrompt(article), generate, (reason) => {
    logger.warn({ msg: "item rejected, retrying", url: article.canonicalUrl, reason });
  }).pipe(
    Effect.map(
      (generated) =>
        ({
          outcome: "written",
          id: article.id,
          // The model's score orders the edition; the code's only until the model has spoken.
          score: article.verdict?.score ?? article.codeScore,
          url: article.canonicalUrl,
          item: generated.object,
          usage: generated.usage ?? null,
        }) satisfies ItemResult,
    ),
    Effect.tap((result) =>
      Effect.sync(() => {
        logger.log({ msg: "item written", url: result.url });
      }),
    ),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.warn({ msg: "article dropped after two attempts", url: article.canonicalUrl, reason: error.reason });
      }).pipe(Effect.as({ outcome: "rejected", url: article.canonicalUrl, reason: error.reason } satisfies ItemResult)),
    ),
  );

// The header gets the same two attempts, but an edition without title and subject is no edition:
// failing twice fails the step.
export const writeHeader = (items: WrittenItem[], generate: Generate<EditionHeader>, logger: LoggerService) =>
  twoAttempts(headerPrompt(items), generate, (reason) => {
    logger.warn({ msg: "header rejected, retrying", reason });
  });

// One transaction: whatever an earlier run left attached goes back to the pool, the approved
// articles get their text and join the edition, and the edition gets its header. Running the step
// again replaces the edition instead of growing it.
export const saveEdition = (
  prisma: PrismaClient,
  p: { editionId: string; header: EditionHeader; written: Written[] },
): Effect.Effect<void, WriteDbFailed> =>
  db(() =>
    prisma.$transaction([
      prisma.article.updateMany({
        where: { editionId: p.editionId },
        data: { editionId: null, category: null, headline: null, body: null },
      }),
      // The score an article joins with is the model's triage, on the 0–5 scale the edition is ordered by.
      ...p.written.map(({ id, item, score }) =>
        prisma.article.update({
          where: { id },
          data: { editionId: p.editionId, category: item.category, headline: item.headline, body: item.body, score },
        }),
      ),
      prisma.edition.update({
        where: { id: p.editionId },
        data: { title: p.header.title, subject: p.header.subject, status: "generating" },
      }),
    ]),
  ).pipe(Effect.asVoid);

// Fewer than `min_articles`: better no edition than a weak one. The owners hear about it. The
// edition is closed, so the fichas nobody chose go with it.
export const skipEdition = (prisma: PrismaClient, editionId: string, now: Date): Effect.Effect<void, WriteDbFailed> =>
  db(() =>
    prisma.$transaction([
      releaseFichas(prisma, now),
      prisma.edition.update({ where: { id: editionId }, data: { status: "skipped" } }),
    ]),
  ).pipe(Effect.asVoid);

// The fichas no edition chose, stored before `before`: deleted when an edition closes, sent or
// skipped. Of what was not chosen only the seen hash stays, so it is not processed again.
export const releaseFichas = (prisma: PrismaClient, before: Date) =>
  prisma.article.deleteMany({ where: { editionId: null, createdAt: { lt: before } } });

// The step's token cost is every call added up: one per article, plus the header, plus the retries.
export function sumUsage(usages: unknown[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const usage of usages) {
    for (const [key, value] of Object.entries((usage ?? {}) as Record<string, unknown>)) {
      if (typeof value === "number") total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}
