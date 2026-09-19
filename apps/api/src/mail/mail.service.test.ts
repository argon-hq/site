import { describe, expect, it, vi } from "vitest";
import type { SettingsService } from "../settings/settings.service";
import { MailService } from "./mail.service";
import { formatAddress, type MailTransport, type Message } from "./mail.types";
import { ResendTransport } from "./transports/resend.transport";
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
