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

// The provider's own id for the message, which the delivery webhook later matches (ARG-100).
export type SentMessage = { id: string | null };

export interface MailTransport {
  readonly name: string;
  send(message: Required<Pick<Message, "from">> & Message): Promise<SentMessage>;
}

// Injection token: the module binds Resend or SMTP to it, and a test binds a fake.
export const MAIL_TRANSPORT = "MAIL_TRANSPORT";

// `Name <address>`, the only format every provider accepts.
export function formatAddress(sender: Sender): string {
  return `${sender.name} <${sender.address}>`;
}
