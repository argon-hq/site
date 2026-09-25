import { Data, Effect } from "effect";
import { dbEffect } from "../effect/db";
import { NOT_FOUND, type Failure } from "../effect/failure";
import type { PrismaClient } from "../generated/prisma/client";
import { editionDate } from "./rules";

export class DeliveryStatusFailed extends Data.TaggedError("DeliveryStatusFailed")<Failure> {}

const db = dbEffect((reason) => new DeliveryStatusFailed({ reason }));

// How many errors the answer quotes. The rest are on their rows; this is enough to see whether the
// failures share a cause.
export const ERROR_SAMPLE = 10;

// Where the day's edition is on its way out: the edition's own state, the rows by status, each batch
// and the first errors. It only reads — a send is `POST /pipeline/send` or the `send` workflow.
export type DeliveryStatus = {
  date: string;
  edition: { id: string; status: string; subject: string | null; sentAt: string | null };
  total: number;
  byStatus: Record<string, number>;
  batches: { batch: number; total: number; byStatus: Record<string, number> }[];
  errors: { subscriberId: string; batch: number; status: string; error: string }[];
};

export const deliveryStatus = (
  prisma: PrismaClient,
  date: string | undefined,
  now: Date = new Date(),
): Effect.Effect<DeliveryStatus, DeliveryStatusFailed> => {
  const day = date ? new Date(`${date}T00:00:00Z`) : editionDate(now);
  const label = day.toISOString().slice(0, 10);
  return Effect.gen(function* () {
    const edition = yield* db(() =>
      prisma.edition.findUnique({
        where: { date: day },
        select: { id: true, status: true, subject: true, sentAt: true },
      }),
    );
    if (!edition)
      return yield* new DeliveryStatusFailed({ reason: `edition ${label} does not exist`, status: NOT_FOUND });

    const [groups, errors] = yield* Effect.all(
      [
        db(() =>
          prisma.delivery.groupBy({
            by: ["batch", "status"],
            where: { editionId: edition.id },
            _count: { _all: true },
            orderBy: [{ batch: "asc" }, { status: "asc" }],
          }),
        ),
        db(() =>
          prisma.delivery.findMany({
            where: { editionId: edition.id, error: { not: null } },
            select: { subscriberId: true, batch: true, status: true, error: true },
            orderBy: [{ batch: "asc" }, { updatedAt: "asc" }],
            take: ERROR_SAMPLE,
          }),
        ),
      ],
      { concurrency: 2 },
    );

    const byStatus: Record<string, number> = {};
    const batches = new Map<number, { batch: number; total: number; byStatus: Record<string, number> }>();
    for (const group of groups) {
      // Prisma types the count of a groupBy loosely; `_all` is what was asked for.
      const count = (group._count as { _all: number })._all;
      byStatus[group.status] = (byStatus[group.status] ?? 0) + count;
      const batch = batches.get(group.batch) ?? { batch: group.batch, total: 0, byStatus: {} };
      batch.total += count;
      batch.byStatus[group.status] = count;
      batches.set(group.batch, batch);
    }

    return {
      date: label,
      edition: {
        id: edition.id,
        status: edition.status,
        subject: edition.subject,
        sentAt: edition.sentAt?.toISOString() ?? null,
      },
      total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      byStatus,
      batches: [...batches.values()],
      errors: errors.map((row) => ({
        subscriberId: row.subscriberId,
        batch: row.batch,
        status: row.status,
        error: row.error ?? "",
      })),
    };
  });
};
