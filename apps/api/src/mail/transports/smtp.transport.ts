import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Transporter } from "nodemailer";
import { formatAddress, type MailTransport, type Message, type SentMessage } from "../mail.types";

// Injection token for the nodemailer transporter. Local development points it at Mailpit, which
// accepts everything and delivers nothing: the e-mail opens at http://localhost:8025.
export const SMTP_TRANSPORTER = "SMTP_TRANSPORTER";

@Injectable()
export class SmtpTransport implements MailTransport {
  readonly name = "smtp";
  private readonly logger = new Logger(SmtpTransport.name);

  constructor(@Inject(SMTP_TRANSPORTER) private readonly transporter: Pick<Transporter, "sendMail">) {}

  async send(message: Required<Pick<Message, "from">> & Message): Promise<SentMessage> {
    const sent = await this.transporter.sendMail({
      from: formatAddress(message.from),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
    });

    this.logger.log({ msg: "message sent", provider: "smtp", id: sent.messageId });
    return { id: sent.messageId ?? null };
  }
}
