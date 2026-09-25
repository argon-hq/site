import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { deliveryStatus, ERROR_SAMPLE } from "./delivery-status";

const edition = { id: "e1", status: "sending", subject: "Selic", sentAt: null };

function prisma(p: { edition?: unknown; groups?: unknown[]; errors?: unknown[] } = {}) {
  return {
    edition: { findUnique: vi.fn(async () => ("edition" in p ? p.edition : edition)) },
    delivery: {
      groupBy: vi.fn(async () => p.groups ?? []),
      findMany: vi.fn(async () => p.errors ?? []),
    },
  };
}

const group = (batch: number, status: string, count: number) => ({ batch, status, _count: { _all: count } });

describe("deliveryStatus", () => {
  it("adds the rows up by status and by batch, for the day asked", async () => {
    const db = prisma({
      groups: [group(1, "sent", 100), group(2, "failed", 3), group(2, "sent", 40), group(3, "pending", 12)],
      errors: [{ subscriberId: "s1", batch: 2, status: "failed", error: "invalid address" }],
    });

    const status = await Effect.runPromise(deliveryStatus(db as unknown as PrismaClient, "2026-09-24"));

    expect(db.edition.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { date: new Date("2026-09-24T00:00:00Z") } }),
    );
    expect(status).toMatchObject({
      date: "2026-09-24",
      edition: { id: "e1", status: "sending" },
      total: 155,
      byStatus: { sent: 140, failed: 3, pending: 12 },
      batches: [
        { batch: 1, total: 100, byStatus: { sent: 100 } },
        { batch: 2, total: 43, byStatus: { failed: 3, sent: 40 } },
        { batch: 3, total: 12, byStatus: { pending: 12 } },
      ],
      errors: [{ subscriberId: "s1", batch: 2, error: "invalid address" }],
    });
    expect(db.delivery.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: ERROR_SAMPLE }));
  });

  it("reads today's edition, São Paulo, when no day is named", async () => {
    const db = prisma();

    const status = await Effect.runPromise(
      deliveryStatus(db as unknown as PrismaClient, undefined, new Date("2026-09-25T02:00:00Z")),
    );

    // 23h in São Paulo is still the 24th.
    expect(status.date).toBe("2026-09-24");
  });

  it("answers 404 for a day with no edition", async () => {
    const db = prisma({ edition: null });

    const exit = await Effect.runPromiseExit(deliveryStatus(db as unknown as PrismaClient, "2026-09-20"));

    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail" && exit.cause.error).toMatchObject({
      reason: "edition 2026-09-20 does not exist",
      status: 404,
    });
  });
});
