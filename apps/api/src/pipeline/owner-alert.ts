import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Effect } from "effect";
import { MailService } from "../mail/mail.service";
import { SettingsService } from "../settings/settings.service";
import { DEPLOYMENT } from "./profile";

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

// When a pipeline step fails, the owners registered in the settings table hear about it. This is an
// internal notice and never reaches a subscriber, so it carries no layout.
@Injectable()
export class OwnerAlert implements OnApplicationBootstrap {
  private readonly logger = new Logger(OwnerAlert.name);

  constructor(
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  // Production with nobody to alert is production that fails in silence. The boot does not stop
  // over it — the row is written through the API, which has to be up for that — but the line it
  // writes is the one the CloudWatch alarm watches, so the silence is heard the same morning.
  async onApplicationBootstrap(): Promise<void> {
    if (DEPLOYMENT !== "prod") return;
    await Effect.runPromise(
      Effect.tryPromise(() => this.settings.get("owner_emails")).pipe(
        Effect.tap((owners) =>
          Effect.sync(() => {
            if (owners.length === 0)
              this.logger.error({ msg: "owner alert skipped", step: "boot", reason: "owner_emails is empty" });
          }),
        ),
        Effect.catchAll((error) =>
          Effect.sync(() => this.logger.error({ msg: "owner alert skipped", step: "boot", reason: String(error) })),
        ),
      ),
    );
  }

  // Never fails: an alert that throws would bury the failure it reports.
  send(step: string, reason: string): Effect.Effect<void> {
    return Effect.tryPromise(async () => {
      const owners = await this.settings.get("owner_emails");
      // The one failure the alert cannot report: an alarm on this line is what does it instead.
      if (owners.length === 0)
        return this.logger.error({ msg: "owner alert skipped", step, reason: "owner_emails is empty" });

      const text = `Step ${step} failed at ${new Date().toISOString()}.\n\n${reason}`;
      const html = `<pre>${text.replace(/[&<>]/g, (c) => ESCAPE[c] ?? c)}</pre>`;
      await Promise.all(owners.map((to) => this.mail.send({ to, subject: `[Argon] step ${step} failed`, text, html })));
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
