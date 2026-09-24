import { Inject, Injectable, Logger } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";
import {
  MAIL_TRANSPORT,
  type BatchDelivery,
  type BatchOptions,
  type FilledMessage,
  type MailTransport,
  type Message,
  type OnSettled,
  type SentBatch,
  type SentMessage,
} from "./mail.types";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    private readonly settings: SettingsService,
  ) {}

  // The only way out of the API. Which provider actually delivers is the module's decision, so
  // nothing that composes an e-mail has to know whether this is Resend or a local Mailpit.
  async send(message: Message): Promise<SentMessage> {
    // Who sends is a business setting, not configuration: one place to change the address.
    const from = message.from ?? (await this.settings.get("sender"));

    const sent = await this.transport.send({ ...message, from });
    this.logger.log({ msg: "mail sent", transport: this.transport.name, to: message.to, id: sent.id });
    return sent;
  }

  // Many messages at once, which is how an edition goes out: the provider's batch endpoint when it
  // has one, and one message at a time when it does not. Either way the answer is one result per
  // message, in the order they were given, so the caller can match a provider id to its own row.
  async sendBatch(messages: Message[], options?: BatchOptions): Promise<SentBatch> {
    if (messages.length === 0) return { results: [] };

    // Once for the whole batch: every message of an edition comes from the same address.
    const from = await this.settings.get("sender");
    const filled = messages.map((message) => ({ ...message, from: message.from ?? from }));

    const sent = this.transport.sendBatch
      ? await this.transport.sendBatch(filled, options)
      : { results: await this.oneAtATime(filled, options?.onSettled) };

    // One line for the batch, not one per message: an edition must not write a log entry per
    // subscriber. What each message got is on its own delivery row.
    const refused = sent.results.filter((result) => result.outcome === "refused").length;
    this.logger.log({
      msg: "mail batch sent",
      transport: this.transport.name,
      size: filled.length,
      sent: filled.length - refused,
      refused,
    });
    return sent;
  }

  // The fallback for a transport with no batch endpoint, such as the local Mailpit, which genuinely
  // delivers one at a time. It catches per message so both paths keep the same promise: a refusal
  // is a result, never an exception. Each result is handed over as it happens, because here there
  // is no idempotency key: what already left must be on record before the next one goes.
  private async oneAtATime(messages: FilledMessage[], onSettled?: OnSettled): Promise<BatchDelivery[]> {
    const results: BatchDelivery[] = [];
    for (const [index, message] of messages.entries()) {
      let result: BatchDelivery;
      try {
        const sent = await this.transport.send(message);
        result = { outcome: "sent", id: sent.id };
      } catch (error) {
        result = { outcome: "refused", reason: String(error) };
      }
      results.push(result);
      await onSettled?.(index, result);
    }
    return results;
  }
}
