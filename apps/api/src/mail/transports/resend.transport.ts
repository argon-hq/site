import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Resend } from "resend";
import { formatAddress, type MailTransport, type Message, type SentMessage } from "../mail.types";

// Injection token for the Resend client, so this transport never builds its own: the module
// creates it from the API key and a test passes a fake with the same shape.
export const RESEND_CLIENT = "RESEND_CLIENT";

@Injectable()
export class ResendTransport implements MailTransport {
  readonly name = "resend";
  private readonly logger = new Logger(ResendTransport.name);

  constructor(@Inject(RESEND_CLIENT) private readonly resend: Pick<Resend, "emails">) {}

  async send(message: Required<Pick<Message, "from">> & Message): Promise<SentMessage> {
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
}
