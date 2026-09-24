import { Effect, Either } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import type { MailService } from "../mail/mail.service";
import type { Recipient } from "./personalize";
import {
  assignBatches,
  batchKey,
  BATCH_SIZE,
  closeEdition,
  countPending,
  createDeliveries,
  deliverBatch,
  groupByBatch,
  highestBatch,
  loadSendable,
  markSending,
  newRecipients,
  recordBatch,
  type PendingRow,
} from "./send";

const date = new Date("2026-09-24T00:00:00.000Z");
const now = new Date("2026-09-24T10:00:00.000Z");

const editionRow = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  status: "ready",
  subject: "Crédito, SELIC e IA",
  html: "<html>",
  text: "texto",
  ...over,
});

// Only the calls the step makes, grouped by model. Enough to check what it asks the database and
// what it writes back.
const fakePrisma = (parts: Record<string, unknown>) => parts as unknown as PrismaClient;

const recipient = (n: number): Recipient => ({ subscriberId: `s${n}`, email: `s${n}@example.com` });
const pendingRow = (id: string, batch: number): PendingRow => ({ id, batch, recipient: recipient(1) });

describe("loadSendable", () => {
  it("reads the day's edition with the two copies the building step stored", async () => {
    const findUnique = vi.fn().mockResolvedValue(editionRow());
    const edition = await Effect.runPromise(loadSendable(fakePrisma({ edition: { findUnique } }), date));

    expect(findUnique.mock.calls[0][0].where).toEqual({ date });
    expect(edition).toEqual({ id: "e1", subject: "Crédito, SELIC e IA", html: "<html>", text: "texto" });
  });

  it("accepts an edition already sending, so a run that stopped halfway can finish it", async () => {
    const findUnique = vi.fn().mockResolvedValue(editionRow({ status: "sending" }));
    const edition = await Effect.runPromise(loadSendable(fakePrisma({ edition: { findUnique } }), date));

    expect(edition.id).toBe("e1");
  });

  it.each(["generating", "skipped", "failed", "sent"])("refuses an edition that is %s", async (status) => {
    const findUnique = vi.fn().mockResolvedValue(editionRow({ status }));
    const result = await Effect.runPromise(Effect.either(loadSendable(fakePrisma({ edition: { findUnique } }), date)));

    expect(Either.isLeft(result) && result.left.reason).toContain(`is ${status}`);
  });

  it("never creates: an edition no run has opened is a failure", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const result = await Effect.runPromise(Effect.either(loadSendable(fakePrisma({ edition: { findUnique } }), date)));

    expect(Either.isLeft(result) && result.left.reason).toContain("does not exist");
  });

  it("refuses an edition whose e-mail was never built", async () => {
    const findUnique = vi.fn().mockResolvedValue(editionRow({ html: null }));
    const result = await Effect.runPromise(Effect.either(loadSendable(fakePrisma({ edition: { findUnique } }), date)));

    expect(Either.isLeft(result) && result.left.reason).toContain("no built e-mail");
  });
});

describe("markSending", () => {
  it("moves the edition to sending before the first message leaves", async () => {
    const update = vi.fn().mockResolvedValue({});
    await Effect.runPromise(markSending(fakePrisma({ edition: { update } }), { editionId: "e1" }));

    expect(update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { status: "sending" } });
  });
});

describe("newRecipients", () => {
  it("asks only for confirmed subscribers with no delivery row for this edition", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "s1", email: "s1@example.com" }]);
    const found = await Effect.runPromise(newRecipients(fakePrisma({ subscriber: { findMany } }), { editionId: "e1" }));

    expect(findMany.mock.calls[0][0].where).toEqual({ status: "confirmed", deliveries: { none: { editionId: "e1" } } });
    expect(found).toEqual([{ subscriberId: "s1", email: "s1@example.com" }]);
  });

  it("asks in a stable order, so who shares a batch never depends on the database's mood", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await Effect.runPromise(newRecipients(fakePrisma({ subscriber: { findMany } }), { editionId: "e1" }));

    expect(findMany.mock.calls[0][0].orderBy).toEqual({ id: "asc" });
  });
});

describe("highestBatch", () => {
  it("starts at zero for an edition that has handed out no batch yet", async () => {
    const aggregate = vi.fn().mockResolvedValue({ _max: { batch: null } });
    const from = await Effect.runPromise(highestBatch(fakePrisma({ delivery: { aggregate } }), { editionId: "e1" }));

    expect(from).toBe(0);
  });

  it("reports the last number the edition used", async () => {
    const aggregate = vi.fn().mockResolvedValue({ _max: { batch: 3 } });
    const from = await Effect.runPromise(highestBatch(fakePrisma({ delivery: { aggregate } }), { editionId: "e1" }));

    expect(from).toBe(3);
  });
});

describe("assignBatches", () => {
  it("puts a hundred subscribers in each batch", () => {
    const rows = assignBatches(
      Array.from({ length: BATCH_SIZE + 1 }, (_, index) => recipient(index)),
      0,
    );

    expect(rows[0].batch).toBe(1);
    expect(rows[BATCH_SIZE - 1].batch).toBe(1);
    expect(rows[BATCH_SIZE].batch).toBe(2);
  });

  it("numbers new subscribers after the edition's highest batch, so nobody joins one that already went out", () => {
    expect(assignBatches([recipient(1)], 3)).toEqual([{ subscriberId: "s1", batch: 4 }]);
  });
});

describe("createDeliveries", () => {
  it("creates every row pending before anything reaches the provider, and skips the ones that exist", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    await Effect.runPromise(
      createDeliveries(fakePrisma({ delivery: { createMany } }), {
        editionId: "e1",
        rows: [{ subscriberId: "s1", batch: 1 }],
      }),
    );

    expect(createMany).toHaveBeenCalledWith({
      data: [{ editionId: "e1", subscriberId: "s1", batch: 1 }],
      skipDuplicates: true,
    });
  });

  it("writes nothing when there is nobody new", async () => {
    const createMany = vi.fn();
    await Effect.runPromise(createDeliveries(fakePrisma({ delivery: { createMany } }), { editionId: "e1", rows: [] }));

    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("groupByBatch", () => {
  it("keeps the batches, and the rows inside each one, in the order they arrived", () => {
    const grouped = groupByBatch([pendingRow("d1", 1), pendingRow("d2", 1), pendingRow("d3", 2)]);

    expect(grouped.map((batch) => batch.batch)).toEqual([1, 2]);
    expect(grouped[0].rows.map((row) => row.id)).toEqual(["d1", "d2"]);
    expect(grouped[1].rows.map((row) => row.id)).toEqual(["d3"]);
  });
});

describe("batchKey", () => {
  it("names a batch by its edition and its number", () => {
    expect(batchKey("e1", 2)).toBe("e1:2");
  });
});

describe("recordBatch", () => {
  it("writes the whole batch in one transaction, so a batch settles or it does not", async () => {
    const calls: unknown[] = [];
    const update = vi.fn((args) => args);
    const prisma = fakePrisma({
      delivery: { update },
      $transaction: vi.fn(async (ops: unknown[]) => calls.push(...ops)),
    });

    await Effect.runPromise(
      recordBatch(prisma, {
        now,
        rows: [
          { id: "d1", result: { outcome: "sent", id: "re_1" } },
          { id: "d2", result: { outcome: "refused", reason: "invalid address" } },
        ],
      }),
    );

    expect(calls).toEqual([
      { where: { id: "d1" }, data: { status: "sent", providerEmailId: "re_1", sentAt: now, error: null } },
      { where: { id: "d2" }, data: { status: "failed", error: "invalid address" } },
    ]);
  });
});

describe("countPending", () => {
  it("counts only what is still waiting, which is what says the edition can close", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const pending = await Effect.runPromise(countPending(fakePrisma({ delivery: { count } }), { editionId: "e1" }));

    expect(count.mock.calls[0][0].where).toEqual({ editionId: "e1", status: "pending" });
    expect(pending).toBe(0);
  });
});

describe("closeEdition", () => {
  it("closes the edition as sent, with the time it went out", async () => {
    const update = vi.fn().mockResolvedValue({});
    await Effect.runPromise(closeEdition(fakePrisma({ edition: { update } }), { editionId: "e1", now }));

    expect(update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { status: "sent", sentAt: now } });
  });
});

describe("deliverBatch", () => {
  it("carries the idempotency key, so the same batch asked twice delivers once", async () => {
    const sendBatch = vi.fn(async () => ({ results: [{ outcome: "sent" as const, id: "re_1" }] }));
    const results = await Effect.runPromise(
      deliverBatch({ sendBatch } as unknown as Pick<MailService, "sendBatch">, {
        messages: [{ to: "s1@example.com", subject: "s", html: "<p>", text: "p" }],
        idempotencyKey: "e1:1",
      }),
    );

    expect(sendBatch).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: "e1:1" });
    expect(results).toEqual([{ outcome: "sent", id: "re_1" }]);
  });

  it("turns a batch the provider refused whole into a failure, so its rows stay pending", async () => {
    const sendBatch = vi.fn(async () => {
      throw new Error("Resend refused the batch: rate_limit_exceeded");
    });
    const result = await Effect.runPromise(
      Effect.either(
        deliverBatch({ sendBatch } as unknown as Pick<MailService, "sendBatch">, {
          messages: [{ to: "s1@example.com", subject: "s", html: "<p>", text: "p" }],
          idempotencyKey: "e1:1",
        }),
      ),
    );

    expect(Either.isLeft(result) && result.left.reason).toContain("rate_limit_exceeded");
  });
});
