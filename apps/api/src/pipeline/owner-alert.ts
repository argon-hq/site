import { Injectable, Logger } from "@nestjs/common";
import { Effect } from "effect";
import { MailService } from "../mail/mail.service";
import { SettingsService } from "../settings/settings.service";

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

// When a pipeline step fails, the owners registered in the settings table hear about it. This is an
// internal notice and never reaches a subscriber, so it carries no layout.
@Injectable()
export class OwnerAlert {
  private readonly logger = new Logger(OwnerAlert.name);

  constructor(
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  // Never fails: an alert that throws would bury the failure it reports.
  send(step: string, reason: string): Effect.Effect<void> {
    return Effect.tryPromise(async () => {
      const owners = await this.settings.get("owner_emails");
      if (owners.length === 0) return this.logger.warn({ msg: "pipeline failed with no owner to alert", step });

      const text = `A etapa ${step} falhou em ${new Date().toISOString()}.\n\n${reason}`;
      const html = `<pre>${text.replace(/[&<>]/g, (c) => ESCAPE[c])}</pre>`;
      await Promise.all(
        owners.map((to) => this.mail.send({ to, subject: `[Argon] falha na etapa ${step}`, text, html })),
      );
      this.logger.log({ msg: "owners alerted", step, owners: owners.length });
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => this.logger.error({ msg: "owner alert failed", step, reason: String(error) })),
      ),
    );
  }

  // Where a boundary turns a failed effect into one alert: the run alerts once, when the workflow
  // gives up, and each per-step route alerts for its own step. The steps themselves carry no alert,
  // or a step that tries again would mail the owners once per attempt.
  onFailure<A, E extends { reason: string }>(step: string, effect: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return effect.pipe(Effect.tapError((error) => this.send(step, error.reason)));
  }
}
