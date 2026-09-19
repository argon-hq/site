import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import type { SettingsService } from "../settings/settings.service";
import { SubscriberService, type SignUpResult } from "./subscriber.service";
import { hashToken } from "./token";

// Only the fields these tests assert on, so the mock stays readable.
type Write = {
  email?: string;
  consentAt?: Date;
  confirmationSends?: number | { increment: number };
  lastConfirmationSentAt?: Date;
  status?: string;
  tokenHash?: string;
  tokenExpiresAt?: Date;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
  consentIp?: string | null;
  consentUserAgent?: string | null;
  policyVersion?: string | null;
};
type UpsertArgs = { where: { email: string }; create: Write; update: Write };
type Row = { id: string; status: string; lastConfirmationSentAt?: Date | null } | null;

function service(existing: Row) {
  const row = existing && { lastConfirmationSentAt: null, ...existing };
  const prisma = {
    subscriber: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(async (args: UpsertArgs) => ({ id: "new-id", email: args.where.email })),
    },
  };
  const settings = { get: vi.fn(async () => "2026-09-01") };
  return {
    prisma,
    subscribers: new SubscriberService(prisma as unknown as PrismaService, settings as unknown as SettingsService),
  };
}

function upsertArgs(prisma: ReturnType<typeof service>["prisma"]): UpsertArgs {
  const call = prisma.subscriber.upsert.mock.calls[0];
  if (!call) throw new Error("upsert was not called");
  return call[0];
}

function tokenOf(result: SignUpResult): string {
  if (result.status !== "pending") throw new Error(`expected pending, got ${result.status}`);
  return result.token;
}

describe("SubscriberService", () => {
  it("records a new address as pending, with the token hashed and the consent", async () => {
    const { prisma, subscribers } = service(null);

    const result = await subscribers.signUp({
      email: "  Joao@Example.COM ",
      consentIp: "203.0.113.7",
      consentUserAgent: "Mozilla/5.0",
    });

    const { where, create } = upsertArgs(prisma);
    expect(where.email).toBe("joao@example.com"); // trimmed and lower-case, as the check constraint requires
    expect(create.email).toBe("joao@example.com");
    expect(create.status).toBe("pending");
    expect(create.consentIp).toBe("203.0.113.7");
    expect(create.consentUserAgent).toBe("Mozilla/5.0");
    expect(create.policyVersion).toBe("2026-09-01");

    // The plain token never reaches the database.
    expect(create.tokenHash).toBe(hashToken(tokenOf(result)));
    expect(create.tokenHash).not.toBe(tokenOf(result));

    const hours = ((create.tokenExpiresAt?.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48);
  });

  it("does not duplicate or touch an address that is already confirmed", async () => {
    const { prisma, subscribers } = service({ id: "abc", status: "confirmed" });

    expect(await subscribers.signUp({ email: "joao@example.com" })).toEqual({ status: "already_confirmed" });
    expect(prisma.subscriber.upsert).not.toHaveBeenCalled();
  });

  it("ignores an address in permanent bounce or blocked", async () => {
    for (const status of ["bounced", "blocked"]) {
      const { prisma, subscribers } = service({ id: "abc", status });
      expect(await subscribers.signUp({ email: "joao@example.com" })).toEqual({ status: "ignored" });
      expect(prisma.subscriber.upsert).not.toHaveBeenCalled();
    }
  });

  it("issues a new token for a pending address and reopens a cancelled one", async () => {
    const pending = service({ id: "abc", status: "pending" });
    await subscribeOnce(pending);
    expect(upsertArgs(pending.prisma).update.tokenHash).toEqual(expect.any(String));

    const cancelled = service({ id: "abc", status: "cancelled" });
    await subscribeOnce(cancelled);
    const { update } = upsertArgs(cancelled.prisma);
    expect(update.status).toBe("pending");
    expect(update.cancelledAt).toBeNull();
    // The row is active again: keeping why it once ended would misread as a current state.
    expect(update.cancellationReason).toBeNull();
  });

  it("keeps the consent already recorded when the new sign-up carries none", async () => {
    const { prisma, subscribers } = service({ id: "abc", status: "pending" });

    await subscribers.signUp({ email: "joao@example.com" });

    // undefined, not null: Prisma leaves the stored columns untouched.
    const { update } = upsertArgs(prisma);
    expect(update.consentIp).toBeUndefined();
    expect(update.consentUserAgent).toBeUndefined();
    expect(update.consentAt).toEqual(expect.any(Date));
  });

  it("sends nothing new while the confirmation just issued is still recent", async () => {
    const { prisma, subscribers } = service({
      id: "abc",
      status: "pending",
      lastConfirmationSentAt: new Date(Date.now() - 20_000),
    });

    expect(await subscribers.signUp({ email: "joao@example.com" })).toEqual({ status: "throttled" });
    // The row is untouched: the link already in the subscriber's inbox stays valid.
    expect(prisma.subscriber.upsert).not.toHaveBeenCalled();
  });

  it("issues a new confirmation once the window has passed, and counts it", async () => {
    const { prisma, subscribers } = service({
      id: "abc",
      status: "pending",
      lastConfirmationSentAt: new Date(Date.now() - 10 * 60_000),
    });

    expect((await subscribers.signUp({ email: "joao@example.com" })).status).toBe("pending");
    const { create, update } = upsertArgs(prisma);
    expect(update.confirmationSends).toEqual({ increment: 1 });
    expect(update.lastConfirmationSentAt).toEqual(expect.any(Date));
    expect(create.confirmationSends).toBe(1);
  });

  it("never throttles an address that has no confirmation on record", async () => {
    const fresh = service(null);
    expect((await fresh.subscribers.signUp({ email: "joao@example.com" })).status).toBe("pending");

    // A pending row from before the counter existed passes too.
    const legacy = service({ id: "abc", status: "pending", lastConfirmationSentAt: null });
    expect((await legacy.subscribers.signUp({ email: "joao@example.com" })).status).toBe("pending");
  });

  it("gives a different token on every sign-up", async () => {
    const first = tokenOf(await service(null).subscribers.signUp({ email: "joao@example.com" }));
    const second = tokenOf(await service(null).subscribers.signUp({ email: "joao@example.com" }));
    expect(first).not.toBe(second);
  });
});

async function subscribeOnce({ subscribers }: ReturnType<typeof service>): Promise<void> {
  const result = await subscribers.signUp({ email: "joao@example.com" });
  expect(result.status).toBe("pending");
}

type Cancelled = {
  id: string;
  email: string;
  status: string;
};
type UpdateArgs = {
  where: { id: string };
  data: { status?: string; cancelledAt?: Date; cancellationReason?: string; unsubscribeTokenHash?: string };
};

function unsubscribeService(row: Cancelled | null) {
  const prisma = {
    subscriber: {
      findFirst: vi.fn(async (args: { where: { unsubscribeTokenHash: string } }) =>
        args.where.unsubscribeTokenHash ? row : null,
      ),
      update: vi.fn(async (args: UpdateArgs) => ({ id: args.where.id })),
    },
  };
  const settings = { get: vi.fn(async () => "") };
  return {
    prisma,
    subscribers: new SubscriberService(prisma as unknown as PrismaService, settings as unknown as SettingsService),
  };
}

const TOKEN = "cRkM2wJq8vN4tL6yB1xZ0aS3dF5gH7jK9lP2oI4uY6e";

describe("SubscriberService.unsubscribe", () => {
  it("cancels a confirmed subscription and records why", async () => {
    const { prisma, subscribers } = unsubscribeService({ id: "abc", email: "joao@example.com", status: "confirmed" });

    const result = await subscribers.unsubscribe(TOKEN);

    expect(result).toEqual({ status: "cancelled", email: "joao@example.com" });
    // Looked up by hash: the plain token is never stored, so it cannot be searched for either.
    expect(prisma.subscriber.findFirst.mock.calls[0]?.[0].where.unsubscribeTokenHash).toBe(hashToken(TOKEN));
    const update = prisma.subscriber.update.mock.calls[0]?.[0];
    expect(update?.data.status).toBe("cancelled");
    expect(update?.data.cancelledAt).toEqual(expect.any(Date));
    expect(update?.data.cancellationReason).toBe("user");
  });

  it("records the operator's own request under its own reason", async () => {
    const { prisma, subscribers } = unsubscribeService({ id: "abc", email: "joao@example.com", status: "confirmed" });

    await subscribers.unsubscribe(TOKEN, "manual");

    expect(prisma.subscriber.update.mock.calls[0]?.[0].data.cancellationReason).toBe("manual");
  });

  it("answers `invalid` for a token nobody holds, without writing", async () => {
    const { prisma, subscribers } = unsubscribeService(null);

    expect(await subscribers.unsubscribe(TOKEN)).toEqual({ status: "invalid" });
    expect(prisma.subscriber.update).not.toHaveBeenCalled();
  });

  it("treats a second click as success, and never rewrites a complaint", async () => {
    for (const status of ["cancelled", "blocked", "bounced"]) {
      const { prisma, subscribers } = unsubscribeService({ id: "abc", email: "joao@example.com", status });

      expect(await subscribers.unsubscribe(TOKEN)).toEqual({
        status: "already_cancelled",
        email: "joao@example.com",
      });
      expect(prisma.subscriber.update).not.toHaveBeenCalled();
    }
  });

  it("cancels a subscription that never got confirmed", async () => {
    const { prisma, subscribers } = unsubscribeService({ id: "abc", email: "joao@example.com", status: "pending" });

    expect((await subscribers.unsubscribe(TOKEN)).status).toBe("cancelled");
    expect(prisma.subscriber.update).toHaveBeenCalled();
  });

  it("stores only the hash of the unsubscribe token it issues", async () => {
    const { prisma, subscribers } = unsubscribeService({ id: "abc", email: "joao@example.com", status: "confirmed" });

    const token = await subscribers.issueUnsubscribeToken("abc");

    const stored = prisma.subscriber.update.mock.calls[0]?.[0].data.unsubscribeTokenHash;
    expect(stored).toBe(hashToken(token));
    expect(stored).not.toBe(token);
  });
});
