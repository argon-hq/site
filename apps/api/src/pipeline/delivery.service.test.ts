import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { MailService } from "../mail/mail.service";
import type { BatchDelivery, Message, OnSettled } from "../mail/mail.types";
import type { PrismaService } from "../prisma/prisma.service";
import type { SettingsService } from "../settings/settings.service";
import { unsubscribeTokenFor } from "../subscriber/token";
import { UNSUBSCRIBE_PLACEHOLDER } from "../subscriber/urls";
import { DeliveryService } from "./delivery.service";

const origins = { web: "https://argon.example", api: "https://api.argon.example" };
const secret = "0123456789abcdef0123456789abcdef";
const date = new Date("2026-09-24T00:00:00Z");
const now = new Date("2026-09-24T10:00:00Z");

const edition = {
  id: "e1",
  status: "ready",
  subject: "Copom mantém a Selic",
  html: `<a href="${origins.web}/newsletter/unsubscribe?token=${UNSUBSCRIBE_PLACEHOLDER}">sair</a>`,
  text: `sair: ${origins.web}/newsletter/unsubscribe?token=${UNSUBSCRIBE_PLACEHOLDER}`,
};

type Row = { id: string; batch: number; subscriber: { id: string; email: string; status: string } };

// The database as the send sees it: today's edition, whoever is confirmed with no row yet, and the
// pending rows grouped by batch. Writes are recorded so a test can read them back.
function world(p: {
  pending: Row[];
  newSubscribers?: { id: string; email: string }[];
  paused?: boolean;
  pausedLater?: boolean;
}) {
  const updates: { where: { id: string }; data: Record<string, unknown> }[] = [];
  const editionUpdates: Record<string, unknown>[] = [];
  let pendingLeft = p.pending.length;
  let pausedReads = 0;
  const prisma = {
    edition: {
      findUnique: vi.fn(async () => edition),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        editionUpdates.push(data);
        return {};
      }),
    },
    subscriber: { findMany: vi.fn(async () => p.newSubscribers ?? []) },
    delivery: {
      aggregate: vi.fn(async () => ({
        _max: { batch: p.pending.length ? Math.max(...p.pending.map((r) => r.batch)) : null },
      })),
      createMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async ({ where }: { where: { status: unknown } }) =>
        typeof where.status === "string" ? pendingLeft : p.pending.length - pendingLeft,
      ),
      findMany: vi.fn(async () => p.pending),
      update: vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push(args);
        pendingLeft -= 1;
        return Promise.resolve({});
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const settings = {
    load: vi.fn(async () => ({ sending_paused: p.paused ?? false })),
    get: vi.fn(async () => {
      pausedReads += 1;
      return p.pausedLater ? pausedReads > 0 : false;
    }),
  };
  const sendBatch = vi.fn(async (messages: Message[]): Promise<{ results: BatchDelivery[] }> => ({
    results: messages.map((m) => ({ outcome: "sent", id: `id-${m.to}` })),
  }));
  const service = new DeliveryService(
    prisma as unknown as PrismaService,
    settings as unknown as SettingsService,
    { sendBatch } as unknown as MailService,
    origins,
    secret,
  );
  return { service, prisma, settings, sendBatch, updates, editionUpdates };
}

const row = (id: string, batch: number, status = "confirmed"): Row => ({
  id,
  batch,
  subscriber: { id: `s-${id}`, email: `${id}@example.com`, status },
});

describe("DeliveryService.send", () => {
  it("mails the confirmed rows with their own tokens, settles the others as failed and closes the edition", async () => {
    const w = world({ pending: [row("d1", 1), row("d2", 1, "cancelled")] });

    const report = await Effect.runPromise(w.service.send(date, now));

    // One message, to the one still confirmed, carrying that subscriber's token in copy and header.
    expect(w.sendBatch).toHaveBeenCalledTimes(1);
    const [messages, options] = w.sendBatch.mock.calls[0] as unknown as [
      Message[],
      { idempotencyKey: string; onSettled?: OnSettled },
    ];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.to).toBe("d1@example.com");
    const token = unsubscribeTokenFor(secret, "s-d1");
    expect(messages[0]?.html).toContain(encodeURIComponent(token));
    expect(messages[0]?.headers?.["List-Unsubscribe"]).toContain(encodeURIComponent(token));
    expect(options.idempotencyKey).toBe("e1:1");

    // Both rows settled: the sent one with its provider id, the cancelled one as failed with why.
    const byId = Object.fromEntries(w.updates.map((u) => [u.where.id, u.data]));
    expect(byId.d1).toMatchObject({ status: "sent", providerEmailId: "id-d1@example.com" });
    expect(byId.d2).toMatchObject({ status: "failed", error: expect.stringContaining("cancelled") });

    // Edition went `sending` first and closed as `sent` when nothing was pending.
    expect(w.editionUpdates[0]).toEqual({ status: "sending" });
    expect(w.editionUpdates.at(-1)).toEqual({ status: "sent", sentAt: now });
    expect(report).toMatchObject({
      status: "sent",
      sent: 1,
      failed: 1,
      batches: [{ batch: 1, size: 2, sent: 1, failed: 1 }],
    });
  });

  it("refuses to record a batch the provider answered out of step, leaving its rows pending", async () => {
    const w = world({ pending: [row("d1", 1), row("d2", 1)] });
    w.sendBatch.mockResolvedValueOnce({ results: [{ outcome: "sent", id: "only-one" }] });

    const exit = await Effect.runPromiseExit(w.service.send(date, now));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(w.updates).toEqual([]);
    expect(w.editionUpdates.at(-1)).toEqual({ status: "sending" });
  });

  it("stops before a batch when the kill switch was turned on mid-run", async () => {
    const w = world({ pending: [row("d1", 1)], pausedLater: true });

    const exit = await Effect.runPromiseExit(w.service.send(date, now));

    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail" && exit.cause.error.status).toBe(409);
    expect(w.sendBatch).not.toHaveBeenCalled();
    expect(w.updates).toEqual([]);
  });

  it("does not start at all when sending is paused", async () => {
    const w = world({ pending: [row("d1", 1)], paused: true });

    const exit = await Effect.runPromiseExit(w.service.send(date, now));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(w.editionUpdates).toEqual([]);
  });

  it("records a row the transport settles on its own, and only the rest at the end", async () => {
    const w = world({ pending: [row("d1", 1), row("d2", 1)] });
    w.sendBatch.mockImplementationOnce(async (messages: Message[], options?: { onSettled?: OnSettled }) => {
      // Like the SMTP fallback: the first message is reported as soon as it leaves.
      await options?.onSettled?.(0, { outcome: "sent", id: "first" });
      return { results: messages.map((m, i) => ({ outcome: "sent", id: i === 0 ? "first" : `id-${m.to}` })) };
    });

    await Effect.runPromise(w.service.send(date, now));

    expect(w.updates.map((u) => u.where.id)).toEqual(["d1", "d2"]);
    expect(w.updates.filter((u) => u.where.id === "d1")).toHaveLength(1);
  });

  it("numbers new subscribers after the highest batch and reports the resume", async () => {
    const w = world({ pending: [row("d9", 3)], newSubscribers: [{ id: "s-new", email: "new@example.com" }] });

    const report = await Effect.runPromise(w.service.send(date, now));

    const created = w.prisma.delivery.createMany.mock.calls[0]?.[0 as never] as
      { data: { batch: number }[] } | undefined;
    expect(created?.data[0]?.batch).toBe(4);
    expect(report.created).toBe(1);
  });
});
