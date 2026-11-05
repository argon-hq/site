import { Data, Effect } from "effect";
import { dbEffect } from "../effect/db";
import { NOT_FOUND, type Failure } from "../effect/failure";
import type { PrismaClient } from "../generated/prisma/client";
import { dayOf } from "./delivery-status";

export class EditionHtmlFailed extends Data.TaggedError("EditionHtmlFailed")<Failure> {}

const db = dbEffect((reason) => new EditionHtmlFailed({ reason }));

// The e-mail the building step stored for a day, one copy for everyone: the unsubscribe link still
// carries the placeholder the send swaps per subscriber. Null fields mean the edition was not built.
export type EditionHtml = {
  date: string;
  status: string;
  subject: string | null;
  html: string | null;
  text: string | null;
};

export const editionHtml = (
  prisma: PrismaClient,
  date: string | undefined,
  now: Date = new Date(),
): Effect.Effect<EditionHtml, EditionHtmlFailed> => {
  const day = dayOf(date, now);
  const label = day.toISOString().slice(0, 10);
  return db(() =>
    prisma.edition.findUnique({
      where: { date: day },
      select: { status: true, subject: true, html: true, text: true },
    }),
  ).pipe(
    Effect.flatMap((row) =>
      row
        ? Effect.succeed({ date: label, ...row })
        : Effect.fail(new EditionHtmlFailed({ reason: `edition ${label} does not exist`, status: NOT_FOUND })),
    ),
  );
};
