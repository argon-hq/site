import { createHmac, timingSafeEqual } from "node:crypto";

// Resend signs its webhooks the Svix way (Standard Webhooks): the headers svix-id, svix-timestamp
// and svix-signature, and the signature is HMAC-SHA256 of "<id>.<timestamp>.<raw body>" under the
// endpoint's secret — "whsec_" followed by the key in base64 — sent as "v1,<base64>", several of
// them separated by spaces while a secret is being rotated. Done here with node:crypto rather than
// through the SDK, which would need a Resend client, and so an API key, on every machine.

// How far the timestamp may be from this clock, either way. It is what keeps a captured request
// from being replayed later: the signature covers the timestamp, so it cannot be moved forward.
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type SignatureHeaders = { id: string; timestamp: string; signature: string };

export function verifySignature(
  secret: string,
  headers: SignatureHeaders,
  body: Buffer,
  now: Date = new Date(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  // Over the bytes as received: a decoded copy would turn invalid UTF-8 into replacement characters.
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest();

  return signature
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .map((part) => Buffer.from(part.slice(3), "base64"))
    .some((candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected));
}
