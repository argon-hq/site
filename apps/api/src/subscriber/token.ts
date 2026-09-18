import { createHash, randomBytes } from "node:crypto";

// 48 hours, the deadline promised on the sign-up screen and written in the confirmation e-mail.
export const CONFIRMATION_TTL_HOURS = 48;

// A repeat sign-up inside this window sends nothing new: the previous link is still valid and
// still on its way. Outside it, a new token is issued and the old one stops working.
export const CONFIRMATION_RESEND_WINDOW_SECONDS = 60;

export type ConfirmationToken = { token: string; hash: string; expiresAt: Date };

// Single use and random. Only the hash is stored: a leaked row cannot confirm anyone.
export function createConfirmationToken(now: Date = new Date()): ConfirmationToken {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_HOURS * 60 * 60 * 1000),
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
