import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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

// Injection token for the secret the unsubscribe tokens are derived from. Bound once, from the
// environment, by the modules that issue or verify them.
export const UNSUBSCRIBE_SECRET = "UNSUBSCRIBE_SECRET";

// Permanent, one per subscriber, derived and never stored: `<subscriber id>.<HMAC-SHA256 of the id
// under the secret>`, in base64url. It is what the unsubscribe link and the List-Unsubscribe header
// carry for the rest of the subscription, and what the sending step writes into each copy of the
// edition — the same token comes out every time, so nothing has to be read back from the database
// where only a hash lives. Rotating the secret invalidates every link already in an inbox: it is a
// deliberate act, not a routine one. The id in the clear gives nothing away: it is an opaque UUID,
// and without the signature it opens no door.
export function unsubscribeTokenFor(secret: string, subscriberId: string): string {
  return `${subscriberId}.${signature(secret, subscriberId)}`;
}

// The subscriber a token belongs to, or null when the signature is not the secret's. Compared in
// constant time: the token is the only credential the public one-click route has.
export function verifyUnsubscribeToken(secret: string, token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const subscriberId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(secret, subscriberId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? subscriberId : null;
}

function signature(secret: string, subscriberId: string): string {
  return createHmac("sha256", secret).update(subscriberId).digest("base64url");
}
