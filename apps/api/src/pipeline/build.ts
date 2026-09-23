import { Data, Effect, Match } from "effect";
import type { PrismaClient } from "../generated/prisma/client";
import type { ArticleRow, EditionRow } from "../email";
import { EditionInvalidError, EditionNotReadyError, EditionRenderError } from "../email";

// The day's edition as the builder needs it: the header the writing step left, and every article
// attached to it. Structural on purpose, like the builder's own rows: a test needs no database.
export type WrittenEdition = { id: string; edition: EditionRow; articles: ArticleRow[] };

export class BuildDbFailed extends Data.TaggedError("BuildDbFailed")<{ reason: string }> {}

const db = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => new BuildDbFailed({ reason: String(error) }) });

// Read, never create: without a written edition there is nothing to build. One already on its way
// out is refused, as in the writing step, and the database freezes a sent one anyway.
export const loadEdition = (prisma: PrismaClient, date: Date): Effect.Effect<WrittenEdition, BuildDbFailed> => {
  const day = date.toISOString().slice(0, 10);
  return db(() =>
    prisma.edition.findUnique({
      where: { date },
      select: {
        id: true,
        date: true,
        title: true,
        subject: true,
        status: true,
        articles: {
          select: { canonicalUrl: true, headline: true, body: true, category: true, score: true, publishedAt: true },
        },
      },
    }),
  ).pipe(
    Effect.flatMap((row) =>
      row === null ? new BuildDbFailed({ reason: `edition ${day} does not exist yet` }) : Effect.succeed(row),
    ),
    Effect.filterOrFail(
      (row) => row.status !== "sending" && row.status !== "sent",
      (row) => new BuildDbFailed({ reason: `edition ${day} is already ${row.status}` }),
    ),
    Effect.map((row) => ({
      id: row.id,
      edition: { date: row.date, title: row.title, subject: row.subject },
      articles: row.articles,
    })),
  );
};

// The only write of the step, and the last thing it does: a validated edition becomes `ready`.
// Running again overwrites the same two columns with the same two strings.
export const saveBuilt = (
  prisma: PrismaClient,
  p: { editionId: string; html: string; text: string },
): Effect.Effect<void, BuildDbFailed> =>
  db(() =>
    prisma.edition.update({ where: { id: p.editionId }, data: { html: p.html, text: p.text, status: "ready" } }),
  ).pipe(Effect.asVoid);

// The builder's three failures speak their own language; the step speaks one reason. An invalid
// edition reports every rule it broke, because one run should tell the whole story once.
export const buildReason = Match.type<EditionNotReadyError | EditionRenderError | EditionInvalidError>().pipe(
  Match.tag("EditionNotReadyError", (error) => error.reason),
  Match.tag("EditionRenderError", (error) => `falha ao renderizar o e-mail: ${String(error.cause)}`),
  Match.tag("EditionInvalidError", (error) =>
    `e-mail reprovado na validação: ${error.errors
      .map((e) => (e.item === undefined ? `${e.code}: ${e.message}` : `${e.code} (notícia ${e.item + 1}): ${e.message}`))
      .join("; ")}`,
  ),
  Match.exhaustive,
);
