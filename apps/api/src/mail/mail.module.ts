import { DynamicModule, Global, Module, Provider } from "@nestjs/common";
import { createTransport } from "nodemailer";
import { Resend } from "resend";
import type { Config } from "../config";
import { MailService } from "./mail.service";
import { MAIL_TRANSPORT } from "./mail.types";
import { RESEND_CLIENT, ResendTransport } from "./transports/resend.transport";
import { SMTP_TRANSPORTER, SmtpTransport } from "./transports/smtp.transport";

// Global: any module injects MailService without importing this one.
@Global()
@Module({})
export class MailModule {
  // The provider is chosen once, here. Resend in AWS; SMTP (Mailpit) in development, where no
  // message may reach a real inbox by accident.
  static forRoot(config: Config): DynamicModule {
    const transport: Provider =
      config.MAIL_TRANSPORT === "resend"
        ? { provide: MAIL_TRANSPORT, useClass: ResendTransport }
        : { provide: MAIL_TRANSPORT, useClass: SmtpTransport };

    const client: Provider =
      config.MAIL_TRANSPORT === "resend"
        ? { provide: RESEND_CLIENT, useFactory: () => new Resend(config.RESEND_API_KEY) }
        : { provide: SMTP_TRANSPORTER, useFactory: () => createTransport(config.SMTP_URL) };

    return {
      module: MailModule,
      providers: [client, transport, MailService],
      exports: [MailService, MAIL_TRANSPORT],
    };
  }
}
