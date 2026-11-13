import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import { DeliveryWebhookService } from "./delivery-webhook.service";

type Row = { id: string; subscriberId: string; status: string } | null;

// A database of one delivery row: the conditional update moves it only from the statuses it is
// given, which is what the real `updateMany ... where status in (...)` does.
function service(row: Row, options: { fail?: boolean } = {}) {
  const state = { row: row && { ...row } };
  const tx = {
    delivery: {
      findFirst: vi.fn(async () => {
        if (options.fail) throw new Error("connection reset");
        return state.row && { ...state.row };
      }),
      updateMany: vi.fn(async (args: { where: { id: string; status: { in: string[] } }; data: { status: string } }) => {
        if (!state.row || !args.where.status.in.includes(state.row.status)) return { count: 0 };
        state.row = { ...state.row, status: args.data.status };
        return { count: 1 };
      }),
    },
    subscriber: {
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const prisma = { $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { tx, state, webhook: new DeliveryWebhookService(prisma as unknown as PrismaService) };
}

const SENT: Row = { id: "d_1", subscriberId: "s_1", status: "sent" };
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("DeliveryWebhookService.apply", () => {
  it("moves a sent delivery to delivered, found by the provider's id", async () => {
    const { webhook, tx, state } = service(SENT);

    await expect(run(webhook.apply({ type: "email.delivered", emailId: "re_1" }))).resolves.toEqual({
      outcome: "applied",
      deliveryId: "d_1",
      status: "delivered",
    });
    expect(tx.delivery.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { providerEmailId: "re_1" } }));
    expect(state.row?.status).toBe("delivered");
    expect(tx.subscriber.update).not.toHaveBeenCalled();
    expect(tx.subscriber.updateMany).not.toHaveBeenCalled();
  });

  it("counts a soft bounce on the subscriber", async () => {
    const { webhook, tx } = service(SENT);

    await run(webhook.apply({ type: "email.bounced", emailId: "re_1", bounceType: "Transient" }));

    expect(tx.subscriber.update).toHaveBeenCalledWith({
      where: { id: "s_1" },
      data: { softBounces: { increment: 1 } },
    });
  });

  it("marks the subscriber bounced on a hard bounce, unless a complaint already blocked them", async () => {
    const { webhook, tx } = service(SENT);

    await run(webhook.apply({ type: "email.bounced", emailId: "re_1", bounceType: "Permanent" }));

    expect(tx.subscriber.updateMany).toHaveBeenCalledWith({
      where: { id: "s_1", status: { not: "blocked" } },
      data: { status: "bounced" },
    });
  });

  it("blocks the subscriber on a spam complaint", async () => {
    const { webhook, tx } = service({ ...SENT, status: "delivered" });

    await run(webhook.apply({ type: "email.complained", emailId: "re_1" }));

    expect(tx.subscriber.update).toHaveBeenCalledWith({ where: { id: "s_1" }, data: { status: "blocked" } });
  });

  it("applies the same event once, however many times it arrives", async () => {
    const { webhook, tx } = service(SENT);
    const bounce = { type: "email.bounced", emailId: "re_1", bounceType: "Transient" };

    await run(webhook.apply(bounce));
    await expect(run(webhook.apply(bounce))).resolves.toEqual({ outcome: "stale", deliveryId: "d_1" });
    expect(tx.subscriber.update).toHaveBeenCalledTimes(1);
  });

  it("does not move a final status back when an older event arrives late", async () => {
    const { webhook, state } = service({ ...SENT, status: "hard_bounce" });

    await expect(run(webhook.apply({ type: "email.delivered", emailId: "re_1" }))).resolves.toEqual({
      outcome: "stale",
      deliveryId: "d_1",
    });
    expect(state.row?.status).toBe("hard_bounce");
  });

  it("does nothing for an id no delivery carries", async () => {
    const { webhook, tx } = service(null);

    await expect(run(webhook.apply({ type: "email.delivered", emailId: "re_x" }))).resolves.toEqual({
      outcome: "unknown",
    });
    expect(tx.delivery.updateMany).not.toHaveBeenCalled();
  });

  it("does not touch the database for an event with nothing final to say", async () => {
    const { webhook, tx } = service(SENT);

    await expect(run(webhook.apply({ type: "email.opened", emailId: "re_1" }))).resolves.toEqual({
      outcome: "ignored",
    });
    expect(tx.delivery.findFirst).not.toHaveBeenCalled();
  });

  it("fails typed when the database does, so the provider retries", async () => {
    const { webhook } = service(SENT, { fail: true });

    const exit = await Effect.runPromiseExit(webhook.apply({ type: "email.delivered", emailId: "re_1" }));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("DeliveryWebhookFailed");
  });
});
