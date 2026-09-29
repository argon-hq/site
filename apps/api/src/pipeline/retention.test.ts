import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import {
  CANCELLED_RETENTION_DAYS,
  RETENTION_BATCH,
  RetentionScheduler,
  SEEN_URL_RETENTION_DAYS,
  TEXT_RETENTION_DAYS,
} from "./retention";

const now = new Date("2026-09-24T07:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

// The database as the trims see it: each statement answers how many rows it touched, in order.
function scheduler(answers: number[]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const $executeRaw = vi.fn(async (query: { strings: string[]; values: unknown[] }) => {
    calls.push({ sql: query.strings.join("?"), values: query.values });
    return answers.shift() ?? 0;
  });
  return { service: new RetentionScheduler({ $executeRaw } as unknown as PrismaService), calls };
}

describe("RetentionScheduler", () => {
  it("clears old article text, deletes old seen links and purges long-cancelled subscribers, each past its window", async () => {
    const { service, calls } = scheduler([3, 2, 1]);

    const report = await Effect.runPromise(service.run(now));

    expect(report).toEqual({ textsCleared: 3, seenUrlsDeleted: 2, subscribersPurged: 1 });
    expect(calls[0]?.sql).toMatch(/UPDATE "article" SET "extracted_text" = NULL/);
    expect(calls[0]?.values).toEqual([daysAgo(TEXT_RETENTION_DAYS), RETENTION_BATCH]);
    expect(calls[1]?.sql).toMatch(/DELETE FROM "seen_url"/);
    expect(calls[1]?.values).toEqual([daysAgo(SEEN_URL_RETENTION_DAYS), RETENTION_BATCH]);
    expect(calls[2]?.sql).toMatch(/DELETE FROM "subscriber"[\s\S]*"status" = 'cancelled'/);
    expect(calls[2]?.values).toEqual([daysAgo(CANCELLED_RETENTION_DAYS), RETENTION_BATCH]);
  });

  it("keeps going in batches until a statement comes back short", async () => {
    const { service, calls } = scheduler([RETENTION_BATCH, RETENTION_BATCH, 7, 0, 0]);

    const report = await Effect.runPromise(service.run(now));

    expect(report.textsCleared).toBe(2 * RETENTION_BATCH + 7);
    expect(calls.filter((c) => c.sql.includes("extracted_text"))).toHaveLength(3);
  });

  it("stops the pass on a database failure and says which trim broke", async () => {
    const { service } = scheduler([]);
    const prisma = { $executeRaw: vi.fn().mockRejectedValueOnce(new Error("connection lost")) };
    const broken = new RetentionScheduler(prisma as unknown as PrismaService);
    void service;

    const exit = await Effect.runPromiseExit(broken.run(now));

    expect(exit._tag).toBe("Failure");
    expect(exit._tag === "Failure" && exit.cause._tag === "Fail" && exit.cause.error.reason).toContain(
      "clear article text",
    );
  });
});
