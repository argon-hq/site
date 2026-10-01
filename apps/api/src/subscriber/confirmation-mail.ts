import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { Data, Effect } from "effect";
import type { Failure } from "../effect/failure";
import { assetBaseUrl } from "../email/assets";
import { buildConfirmation } from "../email/confirmation/build";
import { MailService } from "../mail/mail.service";
import { SettingsService } from "../settings/settings.service";
import { CONFIRMATION_TTL_HOURS } from "./token";
import { confirmUrl, privacyPolicyUrl, socialLinks, type Origins } from "./urls";

// The confirmation did not go out. The caller undoes the send mark and passes this on; the route
// answers 503, because the provider is what failed and the same request may well work in a minute.
export class ConfirmationMailFailed extends Data.TaggedError("ConfirmationMailFailed")<Failure> {}

// Composes and sends the sign-up confirmation: the sender from MailService, the networks from the
// settings, every URL from the environment's origins, and the link from the one-time token.
@Injectable()
export class ConfirmationMail {
  private readonly logger = new Logger(ConfirmationMail.name);

  constructor(
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  send(to: string, token: string, origins: Origins): Effect.Effect<void, ConfirmationMailFailed> {
    const failed = (reason: string) => new ConfirmationMailFailed({ reason, status: HttpStatus.SERVICE_UNAVAILABLE });
    return Effect.gen(this, function* () {
      const [sender, social] = yield* Effect.tryPromise({
        try: () => Promise.all([this.mail.sender(), this.settings.get("social")]),
        catch: (error) => failed(`settings: ${String(error)}`),
      });

      const built = yield* buildConfirmation({
        confirmUrl: confirmUrl(origins, token),
        expiresInHours: CONFIRMATION_TTL_HOURS,
        sender,
        privacyPolicyUrl: privacyPolicyUrl(origins),
        assetBaseUrl: assetBaseUrl(origins.assets),
        social: socialLinks(origins, social),
      }).pipe(Effect.mapError((error) => failed(`the confirmation failed to render: ${String(error.cause)}`)));

      const sent = yield* Effect.tryPromise({
        try: () => this.mail.send({ to, subject: built.subject, html: built.html, text: built.text, from: sender }),
        catch: (error) => failed(`mail: ${String(error)}`),
      });
      this.logger.log({ msg: "confirmation sent", id: sent.id });
    });
  }
}
