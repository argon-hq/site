import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import {
  CONFIRMATION_RESEND_WINDOW_SECONDS,
  createConfirmationToken,
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

@Injectable()
export class SubscriberService {
  private readonly logger = new Logger(SubscriberService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
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
        cancelledAt: null, // signing up again reopens a cancelled subscription
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
    return { status: "pending", token: token.token };
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
