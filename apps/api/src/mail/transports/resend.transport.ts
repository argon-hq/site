import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Resend } from "resend";
import {
  formatAddress,
  type BatchDelivery,
  type BatchOptions,
  type FilledMessage,
  type MailTransport,
  type Message,
  type SentBatch,
  type SentMessage,
} from "../mail.types";

// Injection token for the Resend client, so this transport never builds its own: the module
// creates it from the API key and a test passes a fake with the same shape.
export const RESEND_CLIENT = "RESEND_CLIENT";

@Injectable()
export class ResendTransport implements MailTransport {
  readonly name = "resend";
  private readonly logger = new Logger(ResendTransport.name);

  constructor(@Inject(RESEND_CLIENT) private readonly resend: Pick<Resend, "emails" | "batch">) {}

  async send(message: FilledMessage): Promise<SentMessage> {
    const { data, error } = await this.resend.emails.send({
      from: formatAddress(message.from),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
    });

    // The SDK returns the failure instead of throwing it, so it has to be raised here or a
    // rejected send would look like a delivered one.
    if (error) throw new Error(`Resend refused the message: ${error.name} ${error.message}`);

    this.logger.log({ msg: "message sent", provider: "resend", id: data?.id });
    return { id: data?.id ?? null };
  }

  // One HTTP call for the whole batch, under the idempotency key the sending step derives from the
  // edition and the batch number: asking twice with the same key and the same payload delivers once,
  // which is what makes a run that died after the provider answered safe to repeat.
  async sendBatch(messages: FilledMessage[], options?: BatchOptions): Promise<SentBatch> {
    const payload = messages.map((message) => toPayload(message));

    // Permissive, not the default strict: under strict a single poisoned address fails the whole
    // batch on every attempt, for ever, and the edition never goes out. Permissive delivers the
    // rest and names the ones it refused, by index.
    const result = await this.resend.batch.send(payload, {
      idempotencyKey: options?.idempotencyKey,
      batchValidation: "permissive",
    });

    // A batch refused whole is raised, like a refused message: nothing was delivered, and the
    // caller leaves its rows pending for the next run rather than marking them failed.
    if (result.error) throw new Error(`Resend refused the batch: ${result.error.name} ${result.error.message}`);

    const results = align(payload.length, result.data.data, result.data.errors ?? []);
    this.logger.log({ msg: "batch sent", provider: "resend", size: results.length });
    return { results };
  }
}

function toPayload(message: FilledMessage): Required<Pick<Message, "to" | "subject" | "html" | "text">> & {
  from: string;
  headers?: Record<string, string>;
} {
  return {
    from: formatAddress(message.from),
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: message.headers,
  };
}

// The provider answers a batch with one list of ids and, under permissive validation, a separate
// list of the messages it refused, addressed by index. Neither carries an address, so position is
// the only link back to the message it belongs to — and an id put on the wrong row would later
// attach one subscriber's bounce to another subscriber's delivery. So when the two lists cannot be
// made to add up, this refuses to guess: a batch that fails leaves its rows pending and is sent
// again, while a wrong id is a silent corruption nobody finds for months.
export function align(
  size: number,
  ids: { id: string }[],
  errors: { index: number; message: string }[],
): BatchDelivery[] {
  const refused = new Map(errors.map((error) => [error.index, error.message]));

  // The provider answered positionally, refused slots included.
  if (ids.length === size) {
    return Array.from({ length: size }, (_, index) => {
      const reason = refused.get(index);
      return reason === undefined
        ? ({ outcome: "sent", id: ids[index]?.id ?? null } satisfies BatchDelivery)
        : ({ outcome: "refused", reason } satisfies BatchDelivery);
    });
  }

  // The provider answered only for what it accepted, in order.
  if (ids.length === size - refused.size) {
    let next = 0;
    return Array.from({ length: size }, (_, index) => {
      const reason = refused.get(index);
      return reason === undefined
        ? ({ outcome: "sent", id: ids[next++]?.id ?? null } satisfies BatchDelivery)
        : ({ outcome: "refused", reason } satisfies BatchDelivery);
    });
  }

  throw new Error(
    `Resend answered ${ids.length} id(s) and ${refused.size} refusal(s) for ${size} message(s), which cannot be matched`,
  );
}
