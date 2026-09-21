import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { ConfirmationMail } from "./confirmation-mail";
import { ORIGINS, type Origins } from "./urls";
import {
  CONFIRMATION_RESEND_WINDOW_SECONDS,
  createConfirmationToken,
  createUnsubscribeToken,
  hashToken,
} from "./token";

export type SignUpInput = {
  email: string;
  consentIp?: string;
  consentUserAgent?: string;
};

// `pending` carries the plain token, the only moment it exists outside the browser: the
// confirmation e-mail sends it and the database keeps just the hash.
export type SignUpResult =
  | { status: "pending"; token: string }
  | { status: "throttled" }
  | { status: "already_confirmed" }
  | { status: "ignored" };

// What the confirmation page shows. `expired` is separated from `invalid` because only one of
// them is worth telling the person to sign up again about.
export type ConfirmResult =
  | { status: "confirmed"; email: string }
  | { status: "already_confirmed"; email: string }
  | { status: "expired"; email: string }
  | { status: "invalid" };

// What the subscriber sees on the unsubscribe page. `invalid` covers a token that is wrong,
// truncated by the e-mail client or from a subscriber that no longer exists.
export type UnsubscribeResult =
  | { status: "cancelled"; email: string }
  | { status: "already_cancelled"; email: string }
  | { status: "invalid" };

@Injectable()
export class SubscriberService {
  private readonly logger = new Logger(SubscriberService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly confirmation: ConfirmationMail,
    @Inject(ORIGINS) private readonly origins: Origins,
  ) {}

  // Sign-up is idempotent by e-mail: the same address never becomes a second row.
  async signUp(input: SignUpInput): Promise<SignUpResult> {
    const email = normalizeEmail(input.email);
    const existing = await this.prisma.subscriber.findUnique({
      where: { email },
    });
    // Already in: confirming twice, or signing up again, changes nothing.
    if (existing?.status === "confirmed") {
      this.logger.log({
        msg: "sign-up ignored, already confirmed",
        subscriberId: existing.id,
      });
      return { status: "already_confirmed" };
    }

    // A permanent bounce or a block is not undone by a form: no new attempt is made to this address.
    if (existing?.status === "bounced" || existing?.status === "blocked") {
      this.logger.log({
        msg: "sign-up ignored",
        status: existing.status,
        subscriberId: existing.id,
      });
      return { status: "ignored" };
    }

    // Already waiting for a confirmation sent moments ago: the link in that e-mail stays valid.
    // Issuing another one here would break it and send a second e-mail for the same click.
    if (
      existing?.status === "pending" &&
      withinResendWindow(existing.lastConfirmationSentAt)
    ) {
      this.logger.log({
        msg: "sign-up throttled, confirmation already sent",
        subscriberId: existing.id,
      });
      return { status: "throttled" };
    }

    // New, still pending or cancelled: a fresh token, which invalidates any previous one.
    const now = new Date();
    const token = createConfirmationToken(now);
    // `undefined` keeps what is already stored: signing up again from a client that sends no
    // IP or user agent must not erase the proof of opt-in recorded the first time.
    const consent = {
      consentAt: now,
      consentIp: input.consentIp,
      consentUserAgent: input.consentUserAgent,
      policyVersion: await this.settings.get("policy_version"),
    };

    const subscriber = await this.prisma.subscriber.upsert({
      where: { email },
      create: {
        email,
        status: "pending",
        tokenHash: token.hash,
        tokenExpiresAt: token.expiresAt,
        confirmationSends: 1,
        lastConfirmationSentAt: now,
        ...consent,
      },
      update: {
        status: "pending",
        tokenHash: token.hash,
        tokenExpiresAt: token.expiresAt,
        // Signing up again reopens a cancelled subscription.
        cancelledAt: null,
        confirmationSends: { increment: 1 },
        lastConfirmationSentAt: now,
        ...consent,
      },
    });

    this.logger.log({
      msg: "sign-up pending",
      subscriberId: subscriber.id,
      returning: Boolean(existing),
    });

    await this.sendConfirmation(subscriber.id, email, token.token);
    return { status: "pending", token: token.token };
  }

  // The row is already written when the e-mail goes out, so a provider failure would leave a
  // subscriber holding a token nobody sent — and the resend window would block the retry for a
  // minute. Clearing the mark is what lets the person press the button again right away.
  private async sendConfirmation(id: string, email: string, token: string): Promise<void> {
    try {
      await this.confirmation.send(email, token, this.origins);
    } catch (error) {
      this.logger.error({ msg: "confirmation not sent", subscriberId: id, error: String(error) });
      await this.prisma.subscriber.update({
        where: { id },
        data: { lastConfirmationSentAt: null, confirmationSends: { decrement: 1 } },
      });
      throw error;
    }
  }

  // Turns the one-time token into a confirmed subscription, and issues the permanent unsubscribe
  // token in the same write: the check constraint requires a confirmed row to carry one.
  async confirm(token: string): Promise<ConfirmResult> {
    const subscriber = await this.prisma.subscriber.findFirst({ where: { tokenHash: hashToken(token) } });

    if (!subscriber) {
      this.logger.warn({ msg: "confirmation with unknown token" });
      return { status: "invalid" };
    }

    // Confirming twice is the same click arriving twice, or a mail client prefetching the link.
    if (subscriber.status === "confirmed") {
      return { status: "already_confirmed", email: subscriber.email };
    }

    if (subscriber.status !== "pending") {
      this.logger.warn({ msg: "confirmation for a subscription that is off", status: subscriber.status });
      return { status: "invalid" };
    }

    if (!subscriber.tokenExpiresAt || subscriber.tokenExpiresAt.getTime() < Date.now()) {
      return { status: "expired", email: subscriber.email };
    }

    const unsubscribe = createUnsubscribeToken();
    await this.prisma.subscriber.update({
      where: { id: subscriber.id },
      data: {
        status: "confirmed",
        confirmedAt: new Date(),
        unsubscribeTokenHash: unsubscribe.hash,
        // The hash stays: what makes the token single use is the status guard above, and keeping
        // it is what lets a second click on the same link answer "already confirmed" instead of
        // "this link is broken" — the same click arriving twice is not an error.
      },
    });

    this.logger.log({ msg: "confirmed", subscriberId: subscriber.id });
    return { status: "confirmed", email: subscriber.email };
  }

  // Read-only: the page shows who is about to be unsubscribed and confirms before cancelling.
  // A GET must never cancel — the link scanners in e-mail clients follow it on their own.
  async findByUnsubscribeToken(token: string): Promise<{ email: string; status: string } | null> {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { unsubscribeTokenHash: hashToken(token) },
      select: { email: true, status: true },
    });
    return subscriber;
  }

  // Cancelling twice is not an error: the second click just confirms the subscription is off.
  async unsubscribe(token: string): Promise<UnsubscribeResult> {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { unsubscribeTokenHash: hashToken(token) },
    });

    if (!subscriber) {
      this.logger.warn({ msg: "unsubscribe with unknown token" });
      return { status: "invalid" };
    }

    // Cancelled, bounced or blocked: already off the list, so nothing is rewritten. A spam
    // complaint in particular must not be turned back into an ordinary cancellation.
    if (subscriber.status !== "confirmed" && subscriber.status !== "pending") {
      return { status: "already_cancelled", email: subscriber.email };
    }

    await this.prisma.subscriber.update({
      where: { id: subscriber.id },
      data: { status: "cancelled", cancelledAt: new Date() },
    });

    this.logger.log({ msg: "unsubscribed", subscriberId: subscriber.id });
    return { status: "cancelled", email: subscriber.email };
  }

  // Issued when the subscription is confirmed, which is where the confirmation route will call
  // it. The plain token goes into every edition; the database keeps only the hash.
  async issueUnsubscribeToken(subscriberId: string): Promise<string> {
    const { token, hash } = createUnsubscribeToken();
    await this.prisma.subscriber.update({
      where: { id: subscriberId },
      data: { unsubscribeTokenHash: hash },
    });
    return token;
  }
}

// The window counts from the last confirmation issued, so a row that never had one
// (nothing sent yet) is never throttled.
export function withinResendWindow(
  lastSentAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastSentAt) return false;
  return (
    now.getTime() - lastSentAt.getTime() <
    CONFIRMATION_RESEND_WINDOW_SECONDS * 1000
  );
}

// The check constraint `subscriber_email_normalized` rejects anything else.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
