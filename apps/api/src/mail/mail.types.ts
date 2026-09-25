import type { Sender } from "../email/types";

// What every transport accepts. The templates produce `html` and `text`; `headers` carries what
// only the transport can set, such as `List-Unsubscribe` (RFC 8058) on the edition.
export type Message = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  // Filled from the `sender` setting when the caller does not pass one.
  from?: Sender;
};

// A message with its sender already resolved, which is the only kind a transport ever sees.
export type FilledMessage = Required<Pick<Message, "from">> & Message;

// The provider's own id for the message, which the delivery webhook later matches (ARG-100).
export type SentMessage = { id: string | null };

// How one message of a batch turned out. A refusal is data and not an exception: ninety-nine good
// messages must not be lost because one address was bad.
export type BatchDelivery = { outcome: "sent"; id: string | null } | { outcome: "refused"; reason: string };

// One result per message, in the order the messages were given. Every transport owes that: it is
// the only thing that lets the sending step put a provider id on the right delivery row.
export type SentBatch = { results: BatchDelivery[] };

// Called as each message of a batch settles, with its position and its result. Only a transport
// that genuinely sends one at a time has anything to say before the whole batch is done; it is how
// the caller records what already left when the process dies halfway through.
export type OnSettled = (index: number, result: BatchDelivery) => Promise<void>;

// The provider's idempotency key. The same key with the same payload delivers once, however many
// times it is asked for, which is what makes a resumed batch safe.
export type BatchOptions = { idempotencyKey?: string; onSettled?: OnSettled };

export interface MailTransport {
  readonly name: string;
  send(message: FilledMessage): Promise<SentMessage>;
  // Optional: a provider with no batch endpoint says so by not having this, and MailService sends
  // one at a time instead. A refused message comes back in `results`; a refused batch throws.
  sendBatch?(messages: FilledMessage[], options?: BatchOptions): Promise<SentBatch>;
}

// Injection token: the module binds Resend or SMTP to it, and a test binds a fake.
export const MAIL_TRANSPORT = "MAIL_TRANSPORT";

// `Name <address>`, the only format every provider accepts.
export function formatAddress(sender: Sender): string {
  return `${sender.name} <${sender.address}>`;
}
