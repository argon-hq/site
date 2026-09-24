import { Injectable, Logger } from "@nestjs/common";
import { Effect } from "effect";
import { assetBaseUrl } from "../email/assets";
import { buildConfirmation } from "../email/confirmation/build";
import { MailService } from "../mail/mail.service";
import { SettingsService } from "../settings/settings.service";
import { CONFIRMATION_TTL_HOURS } from "./token";
import { confirmUrl, type Origins } from "./urls";

// Composes and sends the sign-up confirmation: the identity comes from the settings, the link
// from the subscriber's one-time token.
@Injectable()
export class ConfirmationMail {
  private readonly logger = new Logger(ConfirmationMail.name);

  constructor(
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  async send(to: string, token: string, origins: Origins): Promise<void> {
    const identity = await this.settings.load();

    const built = await Effect.runPromise(
      buildConfirmation({
        confirmUrl: confirmUrl(origins, token),
        expiresInHours: CONFIRMATION_TTL_HOURS,
        sender: identity.sender,
        privacyPolicyUrl: identity.privacy_policy_url,
        assetBaseUrl: assetBaseUrl(origins.web),
        social: identity.social,
      }),
    );

    const sent = await this.mail.send({ to, subject: built.subject, html: built.html, text: built.text });
    this.logger.log({ msg: "confirmation sent", id: sent.id });
  }
}
