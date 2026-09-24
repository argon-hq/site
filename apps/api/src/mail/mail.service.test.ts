import { describe, expect, it, vi } from "vitest";
import type { SettingsService } from "../settings/settings.service";
import { MailService } from "./mail.service";
import { formatAddress, type MailTransport, type Message } from "./mail.types";
import { align, ResendTransport } from "./transports/resend.transport";
import { SmtpTransport } from "./transports/smtp.transport";

const sender = { name: "Argon", address: "news@argon.com", postalAddress: "Rua 1, Cidade" };

const message: Message = {
  to: "assinante@example.com",
  subject: "Edição de hoje",
  html: "<p>oi</p>",
  text: "oi",
};

function service(transport: MailTransport) {
  const settings = { get: vi.fn(async () => sender) };
  return new MailService(transport, settings as unknown as SettingsService);
}

describe("MailService", () => {
  it("sends through whatever transport was injected", async () => {
    const transport: MailTransport = { name: "fake", send: vi.fn(async () => ({ id: "abc" })) };

    expect(await service(transport).send(message)).toEqual({ id: "abc" });
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ to: message.to, from: sender }));
  });

  it("takes the sender from the settings, and lets the caller override it", async () => {
    const transport: MailTransport = { name: "fake", send: vi.fn(async () => ({ id: null })) };
    const mail = service(transport);

    await mail.send(message);
    expect(vi.mocked(transport.send).mock.calls[0]?.[0].from).toEqual(sender);

    const other = { name: "Suporte", address: "help@argon.com", postalAddress: "Rua 2" };
    await mail.send({ ...message, from: other });
    expect(vi.mocked(transport.send).mock.calls[1]?.[0].from).toEqual(other);
  });
});

describe("ResendTransport", () => {
  it("sends the message and returns the provider id", async () => {
    const emails = { send: vi.fn(async () => ({ data: { id: "re_123" }, error: null })) };
    const transport = new ResendTransport({ emails } as never);

    expect(await transport.send({ ...message, from: sender, headers: { "List-Unsubscribe": "<https://x>" } })).toEqual({
      id: "re_123",
    });
    expect(emails.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: formatAddress(sender), to: message.to, headers: { "List-Unsubscribe": "<https://x>" } }),
    );
  });

  it("raises the error the SDK returns instead of throwing", async () => {
    // The Resend SDK reports a refusal in the result, so a silent `data: null` would count as sent.
    const emails = { send: vi.fn(async () => ({ data: null, error: { name: "validation_error", message: "bad from" } })) };
    const transport = new ResendTransport({ emails } as never);

    await expect(transport.send({ ...message, from: sender })).rejects.toThrow("Resend refused the message");
  });
});

describe("SmtpTransport", () => {
  it("sends the message and returns the message id", async () => {
    const transporter = { sendMail: vi.fn(async () => ({ messageId: "<abc@argon>" })) };
    const transport = new SmtpTransport(transporter as never);

    expect(await transport.send({ ...message, from: sender })).toEqual({ id: "<abc@argon>" });
    expect(transporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: formatAddress(sender) }));
  });
});

describe("MailService.sendBatch", () => {
  const two = [message, { ...message, to: "outro@example.com" }];

  it("resolves the sender once for the whole batch", async () => {
    const transport: MailTransport = {
      name: "fake",
      send: vi.fn(),
      sendBatch: vi.fn(async () => ({ results: [{ outcome: "sent" as const, id: "a" }, { outcome: "sent" as const, id: "b" }] })),
    };
    const settings = { get: vi.fn(async () => sender) };
    const mail = new MailService(transport, settings as unknown as SettingsService);

    await mail.sendBatch(two);

    expect(settings.get).toHaveBeenCalledTimes(1);
    expect(vi.mocked(transport.sendBatch!).mock.calls[0]?.[0].every((m) => m.from === sender)).toBe(true);
  });

  it("sends one at a time when the transport has no batch endpoint", async () => {
    const transport: MailTransport = { name: "smtp", send: vi.fn(async () => ({ id: "<x@argon>" })) };

    const sent = await service(transport).sendBatch(two);

    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(sent.results).toEqual([
      { outcome: "sent", id: "<x@argon>" },
      { outcome: "sent", id: "<x@argon>" },
    ]);
  });

  it("turns a message the fallback transport refused into a result, not an exception", async () => {
    // Both paths owe the same contract: one result per message, and a refusal is data.
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: "<x@argon>" })
      .mockRejectedValueOnce(new Error("mailbox unavailable"));
    const transport: MailTransport = { name: "smtp", send };

    const sent = await service(transport).sendBatch(two);

    expect(sent.results[0]).toEqual({ outcome: "sent", id: "<x@argon>" });
    expect(sent.results[1]?.outcome === "refused" && sent.results[1].reason).toContain("mailbox unavailable");
  });

  it("settles each message of the fallback as it goes, before the next one leaves", async () => {
    const order: string[] = [];
    const send = vi.fn(async (message: { to: string }) => {
      order.push(`send ${message.to}`);
      return { id: `<${message.to}>` };
    });
    const transport: MailTransport = { name: "smtp", send };
    const onSettled = vi.fn(async (index: number) => {
      order.push(`settled ${index}`);
    });

    await service(transport).sendBatch(two, { onSettled });

    expect(order).toEqual([`send ${two[0]?.to}`, "settled 0", `send ${two[1]?.to}`, "settled 1"]);
    expect(onSettled).toHaveBeenCalledWith(0, { outcome: "sent", id: `<${two[0]?.to}>` });
  });

  it("answers an empty batch without touching the transport or the settings", async () => {
    const transport: MailTransport = { name: "fake", send: vi.fn(), sendBatch: vi.fn() };
    const settings = { get: vi.fn() };
    const mail = new MailService(transport, settings as unknown as SettingsService);

    expect(await mail.sendBatch([])).toEqual({ results: [] });
    expect(settings.get).not.toHaveBeenCalled();
    expect(transport.sendBatch).not.toHaveBeenCalled();
  });
});

describe("ResendTransport.sendBatch", () => {
  const filled = [
    { ...message, from: sender },
    { ...message, to: "outro@example.com", from: sender },
  ];

  it("sends one payload, carrying the idempotency key and asking for permissive validation", async () => {
    const batch = { send: vi.fn(async () => ({ data: { data: [{ id: "re_1" }, { id: "re_2" }], errors: [] }, error: null })) };
    const transport = new ResendTransport({ batch } as never);

    const sent = await transport.sendBatch(filled, { idempotencyKey: "e1:1" });

    expect(batch.send).toHaveBeenCalledTimes(1);
    expect(batch.send).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: "e1:1",
      batchValidation: "permissive",
    });
    expect(sent.results).toEqual([
      { outcome: "sent", id: "re_1" },
      { outcome: "sent", id: "re_2" },
    ]);
  });

  it("raises a batch the provider refused whole, so no row is recorded as sent", async () => {
    const batch = { send: vi.fn(async () => ({ data: null, error: { name: "rate_limit_exceeded", message: "slow down" } })) };
    const transport = new ResendTransport({ batch } as never);

    await expect(transport.sendBatch(filled)).rejects.toThrow("Resend refused the batch");
  });
});

describe("align", () => {
  it("reads the ids by position when the provider answered for every message", () => {
    expect(align(2, [{ id: "re_1" }, { id: "re_2" }], [])).toEqual([
      { outcome: "sent", id: "re_1" },
      { outcome: "sent", id: "re_2" },
    ]);
  });

  it("puts an individual refusal on its own message and delivers the rest", () => {
    expect(align(3, [{ id: "re_1" }, { id: "re_3" }], [{ index: 1, message: "invalid address" }])).toEqual([
      { outcome: "sent", id: "re_1" },
      { outcome: "refused", reason: "invalid address" },
      { outcome: "sent", id: "re_3" },
    ]);
  });

  it("also reads an answer that kept a slot for the message it refused", () => {
    expect(align(2, [{ id: "re_1" }, { id: "" }], [{ index: 1, message: "invalid address" }])).toEqual([
      { outcome: "sent", id: "re_1" },
      { outcome: "refused", reason: "invalid address" },
    ]);
  });

  it("refuses to guess when the answer has a length it cannot explain", () => {
    // An id on the wrong row would attach one subscriber's bounce to another's delivery. A batch
    // that fails leaves its rows pending and is sent again; a wrong id is never noticed.
    expect(() => align(3, [{ id: "re_1" }], [])).toThrow("cannot be matched");
  });
});
