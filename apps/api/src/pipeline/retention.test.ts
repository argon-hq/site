import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import {
  CANCELLED_RETENTION_DAYS,
  FICHA_RETENTION_DAYS,
  RETENTION_BATCH,
  RetentionScheduler,
  SEEN_URL_RETENTION_DAYS,
  SIGNATURE_RETENTION_DAYS,
  TEXT_RETENTION_DAYS,
  UNCONFIRMED_GRACE_DAYS,
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
  it("deletes stale fichas, clears old text and signatures, deletes old seen links and purges long-cancelled subscribers and discards dead sign-ups", async () => {
    const { service, calls } = scheduler([5, 3, 4, 2, 1, 6]);

    const report = await Effect.runPromise(service.run(now));

    expect(report).toEqual({
      fichasDeleted: 5,
      textsCleared: 3,
      signaturesCleared: 4,
      seenUrlsDeleted: 2,
      subscribersPurged: 1,
      unconfirmedDiscarded: 6,
    });
    expect(calls[0]?.sql).toMatch(/DELETE FROM "article"[\s\S]*"edition_id" IS NULL/);
    expect(calls[0]?.values).toEqual([daysAgo(FICHA_RETENTION_DAYS), RETENTION_BATCH]);
    expect(calls[1]?.sql).toMatch(/UPDATE "article" SET "extracted_text" = NULL/);
    expect(calls[1]?.values).toEqual([daysAgo(TEXT_RETENTION_DAYS), RETENTION_BATCH]);
    expect(calls[2]?.sql).toMatch(/UPDATE "article" SET "title_signature" = '\{\}'/);
    expect(calls[2]?.values).toEqual([daysAgo(SIGNATURE_RETENTION_DAYS), RETENTION_BATCH]);
    expect(calls[3]?.sql).toMatch(/DELETE FROM "seen_url"[\s\S]*"url_hash"/);
    expect(calls[3]?.values).toEqual([daysAgo(SEEN_URL_RETENTION_DAYS), RETENTION_BATCH]);
    expect(calls[4]?.sql).toMatch(/DELETE FROM "subscriber"[\s\S]*"status" = 'cancelled'/);
    expect(calls[4]?.values).toEqual([daysAgo(CANCELLED_RETENTION_DAYS), RETENTION_BATCH]);
    expect(calls[5]?.sql).toMatch(/DELETE FROM "subscriber"[\s\S]*"status" = 'pending'[\s\S]*"token_expires_at" </);
    expect(calls[5]?.values).toEqual([daysAgo(UNCONFIRMED_GRACE_DAYS), RETENTION_BATCH]);
  });

  it("keeps the seen links for the 48 h window and a day more, and nothing of the feed past three days", () => {
    expect(SEEN_URL_RETENTION_DAYS).toBe(3);
    expect(FICHA_RETENTION_DAYS).toBe(3);
    expect(SIGNATURE_RETENTION_DAYS).toBe(3);
  });

  it("keeps going in batches until a statement comes back short", async () => {
    const { service, calls } = scheduler([0, RETENTION_BATCH, RETENTION_BATCH, 7, 0, 0, 0]);

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
      "delete old fichas",
    );
  });
});
