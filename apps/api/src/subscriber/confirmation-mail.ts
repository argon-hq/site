import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { Data, Effect } from "effect";
import type { Failure } from "../effect/failure";
import { assetBaseUrl } from "../email/assets";
import { buildConfirmation } from "../email/confirmation/build";
import { MailService } from "../mail/mail.service";
import { SettingsService } from "../settings/settings.service";
import { CONFIRMATION_TTL_HOURS } from "./token";
import { confirmUrl, type Origins } from "./urls";

// The confirmation did not go out. The caller undoes the send mark and passes this on; the route
// answers 503, because the provider is what failed and the same request may well work in a minute.
export class ConfirmationMailFailed extends Data.TaggedError("ConfirmationMailFailed")<Failure> {}

// Composes and sends the sign-up confirmation: the identity comes from the settings, the link
// from the subscriber's one-time token.
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
      const identity = yield* Effect.tryPromise({
        try: () => this.settings.load(),
        catch: (error) => failed(`settings: ${String(error)}`),
      });

      const built = yield* buildConfirmation({
        confirmUrl: confirmUrl(origins, token),
        expiresInHours: CONFIRMATION_TTL_HOURS,
        sender: identity.sender,
        privacyPolicyUrl: identity.privacy_policy_url,
        assetBaseUrl: assetBaseUrl(origins.web),
        social: identity.social,
      }).pipe(Effect.mapError((error) => failed(`the confirmation failed to render: ${String(error.cause)}`)));

      const sent = yield* Effect.tryPromise({
        try: () => this.mail.send({ to, subject: built.subject, html: built.html, text: built.text }),
        catch: (error) => failed(`mail: ${String(error)}`),
      });
      this.logger.log({ msg: "confirmation sent", id: sent.id });
    });
  }
}
