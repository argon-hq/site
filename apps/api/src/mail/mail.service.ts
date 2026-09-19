import { Inject, Injectable, Logger } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";
import { MAIL_TRANSPORT, type MailTransport, type Message, type SentMessage } from "./mail.types";

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
}
