import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import type { SettingsService } from "../settings/settings.service";
import type { ConfirmationMail } from "./confirmation-mail";
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
  consentIp?: string | null;
  consentUserAgent?: string | null;
  policyVersion?: string | null;
};
type UpsertArgs = { where: { email: string }; create: Write; update: Write };
type Row = { id: string; status: string; lastConfirmationSentAt?: Date | null } | null;

const origins = { web: "https://argon.example", api: "https://api.argon.example" };

function service(existing: Row) {
  const row = existing && { lastConfirmationSentAt: null, ...existing };
  const prisma = {
    subscriber: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(async (args: UpsertArgs) => ({ id: "new-id", email: args.where.email })),
      update: vi.fn(async () => ({ id: "new-id" })),
    },
  };
  const settings = { get: vi.fn(async () => "2026-09-01") };
  const confirmation = { send: vi.fn(async () => undefined) };
  return {
    prisma,
    confirmation,
    subscribers: new SubscriberService(
      prisma as unknown as PrismaService,
      settings as unknown as SettingsService,
      confirmation as unknown as ConfirmationMail,
      origins,
    ),
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

  it("sends the confirmation with the token that was stored, hashed", async () => {
    const { confirmation, prisma, subscribers } = service(null);

    const result = await subscribers.signUp({ email: "joao@example.com" });

    expect(confirmation.send).toHaveBeenCalledWith("joao@example.com", tokenOf(result), origins);
    expect(upsertArgs(prisma).create.tokenHash).toBe(hashToken(tokenOf(result)));
  });

  it("does not send to an address that is confirmed, blocked or still inside the window", async () => {
    const confirmed = service({ id: "abc", status: "confirmed" });
    await confirmed.subscribers.signUp({ email: "joao@example.com" });
    expect(confirmed.confirmation.send).not.toHaveBeenCalled();

    const blocked = service({ id: "abc", status: "blocked" });
    await blocked.subscribers.signUp({ email: "joao@example.com" });
    expect(blocked.confirmation.send).not.toHaveBeenCalled();

    const recent = service({ id: "abc", status: "pending", lastConfirmationSentAt: new Date() });
    await recent.subscribers.signUp({ email: "joao@example.com" });
    expect(recent.confirmation.send).not.toHaveBeenCalled();
  });

  it("clears the send mark when the provider fails, so the person can try again at once", async () => {
    const { confirmation, prisma, subscribers } = service(null);
    confirmation.send.mockRejectedValueOnce(new Error("provider down"));

    await expect(subscribers.signUp({ email: "joao@example.com" })).rejects.toThrow("provider down");

    // Left as it was, the resend window would block the retry for a minute over an e-mail that
    // never left.
    expect(prisma.subscriber.update).toHaveBeenCalledWith({
      where: { id: "new-id" },
      data: { lastConfirmationSentAt: null, confirmationSends: { decrement: 1 } },
    });
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
  data: {
    status?: string;
    cancelledAt?: Date;
    confirmedAt?: Date;
    unsubscribeTokenHash?: string | null;
    tokenHash?: string | null;
    tokenExpiresAt?: Date | null;
  };
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
  const confirmation = { send: vi.fn(async () => undefined) };
  return {
    prisma,
    subscribers: new SubscriberService(
      prisma as unknown as PrismaService,
      settings as unknown as SettingsService,
      confirmation as unknown as ConfirmationMail,
      origins,
    ),
  };
}

const TOKEN = "cRkM2wJq8vN4tL6yB1xZ0aS3dF5gH7jK9lP2oI4uY6e";

describe("SubscriberService.confirm", () => {
  function confirmService(row: (Cancelled & { tokenExpiresAt?: Date | null }) | null) {
    const prisma = {
      subscriber: {
        findFirst: vi.fn(async (args: { where: { tokenHash: string } }) => (args.where.tokenHash ? row : null)),
        update: vi.fn(async (args: UpdateArgs) => ({ id: args.where.id })),
      },
    };
    const settings = { get: vi.fn(async () => "") };
    const confirmation = { send: vi.fn(async () => undefined) };
    return {
      prisma,
      subscribers: new SubscriberService(
        prisma as unknown as PrismaService,
        settings as unknown as SettingsService,
        confirmation as unknown as ConfirmationMail,
        origins,
      ),
    };
  }

  const inAnHour = () => new Date(Date.now() + 3_600_000);

  it("confirms a pending subscription and issues the unsubscribe token", async () => {
    const { prisma, subscribers } = confirmService({
      id: "abc",
      email: "joao@example.com",
      status: "pending",
      tokenExpiresAt: inAnHour(),
    });

    expect(await subscribers.confirm(TOKEN)).toEqual({ status: "confirmed", email: "joao@example.com" });

    const { data } = prisma.subscriber.update.mock.calls[0]?.[0] ?? { data: {} };
    expect(data.status).toBe("confirmed");
    // The confirmed row has to carry an unsubscribe token; the check constraint requires it.
    expect(data.unsubscribeTokenHash).toEqual(expect.any(String));
    // The confirmation hash is kept on purpose: the status is what stops a second confirmation,
    // and the row has to stay findable so the same link clicked twice is not an error.
    expect(data.tokenHash).toBeUndefined();
  });

  it("looks the subscriber up by the hash, never by the token itself", async () => {
    const { prisma, subscribers } = confirmService({
      id: "abc",
      email: "joao@example.com",
      status: "pending",
      tokenExpiresAt: inAnHour(),
    });

    await subscribers.confirm(TOKEN);

    expect(prisma.subscriber.findFirst.mock.calls[0]?.[0].where.tokenHash).toBe(hashToken(TOKEN));
  });

  it("treats a second click as success, without writing again", async () => {
    const { prisma, subscribers } = confirmService({ id: "abc", email: "joao@example.com", status: "confirmed" });

    expect(await subscribers.confirm(TOKEN)).toEqual({ status: "already_confirmed", email: "joao@example.com" });
    expect(prisma.subscriber.update).not.toHaveBeenCalled();
  });

  it("refuses a token past its deadline, and says so", async () => {
    const { prisma, subscribers } = confirmService({
      id: "abc",
      email: "joao@example.com",
      status: "pending",
      tokenExpiresAt: new Date(Date.now() - 1000),
    });

    expect(await subscribers.confirm(TOKEN)).toEqual({ status: "expired", email: "joao@example.com" });
    expect(prisma.subscriber.update).not.toHaveBeenCalled();
  });

  it("refuses an unknown token and a cancelled subscription", async () => {
    expect(await confirmService(null).subscribers.confirm(TOKEN)).toEqual({ status: "invalid" });

    const cancelled = confirmService({ id: "abc", email: "joao@example.com", status: "cancelled" });
    expect(await cancelled.subscribers.confirm(TOKEN)).toEqual({ status: "invalid" });
    expect(cancelled.prisma.subscriber.update).not.toHaveBeenCalled();
  });
});

describe("SubscriberService.unsubscribe", () => {
  it("cancels a confirmed subscription", async () => {
    const { prisma, subscribers } = unsubscribeService({ id: "abc", email: "joao@example.com", status: "confirmed" });

    const result = await subscribers.unsubscribe(TOKEN);

    expect(result).toEqual({ status: "cancelled", email: "joao@example.com" });
    // Looked up by hash: the plain token is never stored, so it cannot be searched for either.
    expect(prisma.subscriber.findFirst.mock.calls[0]?.[0].where.unsubscribeTokenHash).toBe(hashToken(TOKEN));
    const update = prisma.subscriber.update.mock.calls[0]?.[0];
    expect(update?.data.status).toBe("cancelled");
    expect(update?.data.cancelledAt).toEqual(expect.any(Date));
  });

  it("answers `invalid` for a token nobody holds, without writing", async () => {
    const { prisma, subscribers } = unsubscribeService(null);

    expect(await subscribers.unsubscribe(TOKEN)).toEqual({ status: "invalid" });
    expect(prisma.subscriber.update).not.toHaveBeenCalled();
  });

  it("treats a second click as success, and never rewrites an address already off the list", async () => {
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
