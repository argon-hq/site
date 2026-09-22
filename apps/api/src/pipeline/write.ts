import type { LoggerService } from "@nestjs/common";
import { Data, Effect } from "effect";
import type { PrismaClient } from "../generated/prisma/client";
import { twoAttempts } from "../mastra/attempts";
import { BODY_MAX, CATEGORIES, SUBJECT_MAX, type EditionHeader, type WrittenItem } from "../mastra/schemas/edition";

// One article the step may write: collected, above the cutoff and not yet in another edition.
export type Candidate = {
  id: string;
  canonicalUrl: string;
  sourceName: string;
  originalTitle: string;
  extractedText: string;
};

export type ItemResult =
  | { outcome: "written"; id: string; url: string; item: WrittenItem; usage: unknown }
  | { outcome: "rejected"; url: string; reason: string };

export type WrittenResult = Extract<ItemResult, { outcome: "written" }>;
export type Written = { id: string; item: WrittenItem };

// A generation that already carries its reason, so the second attempt can quote it.
export class ItemFailed extends Data.TaggedError("ItemFailed")<{ reason: string }> {}
export class WriteDbFailed extends Data.TaggedError("WriteDbFailed")<{ reason: string }> {}

export type Generate<A> = (prompt: string) => Effect.Effect<{ object: A; usage?: unknown }, ItemFailed>;

const db = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => new WriteDbFailed({ reason: String(error) }) });

// Today's edition, created on the first run of the day. Running the step again reuses the row; one
// already on its way out is never rewritten, and the database freezes a sent one anyway.
export const openEdition = (prisma: PrismaClient, date: Date) =>
  db(() =>
    prisma.edition.upsert({ where: { date }, create: { date }, update: {}, select: { id: true, status: true } }),
  ).pipe(
    Effect.filterOrFail(
      (edition) => edition.status !== "sending" && edition.status !== "sent",
      (edition) => new WriteDbFailed({ reason: `edition ${date.toISOString().slice(0, 10)} is already ${edition.status}` }),
    ),
  );

// What the collection left ready to write: inside the window, above the cutoff, with text, and
// either unattached or already part of this edition — so a second run rewrites the same set.
export const selectCandidates = (
  prisma: PrismaClient,
  p: { editionId: string; since: Date; cutoff: number; max: number },
): Effect.Effect<Candidate[], WriteDbFailed> =>
  db(() =>
    prisma.article.findMany({
      where: {
        OR: [{ editionId: null }, { editionId: p.editionId }],
        createdAt: { gte: p.since },
        score: { gte: p.cutoff },
        extractedText: { not: null },
      },
      orderBy: [{ score: "desc" }, { publishedAt: "desc" }],
      take: p.max,
      select: { id: true, canonicalUrl: true, sourceName: true, originalTitle: true, extractedText: true },
    }),
  ).pipe(Effect.map((rows) => rows.filter((row): row is Candidate => Boolean(row.extractedText))));

// Limits come from the code into the prompt; the skill holds the craft.
export function itemPrompt(article: Candidate): string {
  return [
    'Carregue a skill "write" com a ferramenta skill e siga o processo dela.',
    "Escreva o item desta notícia, e só dela.",
    `Categorias: ${Object.keys(CATEGORIES).join(", ")}.`,
    `Corpo: até ${BODY_MAX} caracteres, contando espaços.`,
    `Fonte: ${article.sourceName}`,
    `Título original: ${article.originalTitle}`,
    "--- notícia ---",
    article.extractedText,
    "--- fim ---",
  ].join("\n");
}

export function headerPrompt(items: WrittenItem[]): string {
  return [
    'Carregue a skill "write" com a ferramenta skill e siga o processo dela.',
    "Escreva o título e o assunto do e-mail da edição de hoje, a partir das notícias abaixo.",
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
  twoAttempts(itemPrompt(article), generate, (reason) =>
    logger.warn({ msg: "item rejected, retrying", url: article.canonicalUrl, reason }),
  ).pipe(
    Effect.map(
      (generated) =>
        ({
          outcome: "written",
          id: article.id,
          url: article.canonicalUrl,
          item: generated.object,
          usage: generated.usage ?? null,
        }) satisfies ItemResult,
    ),
    Effect.tap((result) => Effect.sync(() => logger.log({ msg: "item written", url: result.url }))),
    Effect.catchAll((error) =>
      Effect.sync(() =>
        logger.warn({ msg: "article dropped after two attempts", url: article.canonicalUrl, reason: error.reason }),
      ).pipe(Effect.as({ outcome: "rejected", url: article.canonicalUrl, reason: error.reason } satisfies ItemResult)),
    ),
  );

// The header gets the same two attempts, but an edition without title and subject is no edition:
// failing twice fails the step.
export const writeHeader = (items: WrittenItem[], generate: Generate<EditionHeader>, logger: LoggerService) =>
  twoAttempts(headerPrompt(items), generate, (reason) =>
    logger.warn({ msg: "header rejected, retrying", reason }),
  );

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
      ...p.written.map(({ id, item }) =>
        prisma.article.update({
          where: { id },
          data: { editionId: p.editionId, category: item.category, headline: item.headline, body: item.body },
        }),
      ),
      prisma.edition.update({
        where: { id: p.editionId },
        data: { title: p.header.title, subject: p.header.subject, status: "generating" },
      }),
    ]),
  ).pipe(Effect.asVoid);

// Fewer than `min_articles`: better no edition than a weak one. The owners hear about it.
export const skipEdition = (prisma: PrismaClient, editionId: string): Effect.Effect<void, WriteDbFailed> =>
  db(() => prisma.edition.update({ where: { id: editionId }, data: { status: "skipped" } })).pipe(Effect.asVoid);

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
