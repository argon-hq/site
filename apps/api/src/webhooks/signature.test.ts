import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SIGNATURE_TOLERANCE_SECONDS, verifySignature } from "./signature";

const KEY = randomBytes(24);
const SECRET = `whsec_${KEY.toString("base64")}`;
const NOW = new Date("2026-11-13T10:00:00Z");
const NOW_SECONDS = String(Math.floor(NOW.getTime() / 1000));
const BODY = '{"type":"email.delivered","data":{"email_id":"abc"}}';

// What the provider does on its side (Svix): HMAC-SHA256 of "<id>.<timestamp>.<body>" under the
// decoded secret, base64, prefixed with the version.
function sign(id: string, timestamp: string, body: string, key: Buffer = KEY): string {
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

function headers(overrides: Partial<{ id: string; timestamp: string; signature: string }> = {}) {
  const id = overrides.id ?? "msg_1";
  const timestamp = overrides.timestamp ?? NOW_SECONDS;
  return { id, timestamp, signature: overrides.signature ?? sign(id, timestamp, BODY) };
}

describe("verifySignature", () => {
  it("accepts the body the provider signed", () => {
    expect(verifySignature(SECRET, headers(), BODY, NOW)).toBe(true);
  });

  it("accepts when any of several signatures matches, as during a secret rotation", () => {
    const other = sign("msg_1", NOW_SECONDS, BODY, randomBytes(24));
    const good = sign("msg_1", NOW_SECONDS, BODY);
    expect(verifySignature(SECRET, headers({ signature: `${other} ${good}` }), BODY, NOW)).toBe(true);
  });

  it("refuses a body changed after signing", () => {
    expect(verifySignature(SECRET, headers(), BODY.replace("delivered", "bounced"), NOW)).toBe(false);
  });

  it("refuses a signature made under another secret", () => {
    const forged = sign("msg_1", NOW_SECONDS, BODY, randomBytes(24));
    expect(verifySignature(SECRET, headers({ signature: forged }), BODY, NOW)).toBe(false);
  });

  it("refuses a signature replayed under another message id", () => {
    expect(verifySignature(SECRET, headers({ id: "msg_2", signature: sign("msg_1", NOW_SECONDS, BODY) }), BODY, NOW)).toBe(
      false,
    );
  });

  it("refuses a timestamp outside the tolerance, either way", () => {
    const old = String(Number(NOW_SECONDS) - SIGNATURE_TOLERANCE_SECONDS - 1);
    const future = String(Number(NOW_SECONDS) + SIGNATURE_TOLERANCE_SECONDS + 1);
    expect(verifySignature(SECRET, headers({ timestamp: old }), BODY, NOW)).toBe(false);
    expect(verifySignature(SECRET, headers({ timestamp: future }), BODY, NOW)).toBe(false);
  });

  it("accepts a timestamp at the edge of the tolerance", () => {
    const edge = String(Number(NOW_SECONDS) - SIGNATURE_TOLERANCE_SECONDS);
    expect(verifySignature(SECRET, headers({ timestamp: edge }), BODY, NOW)).toBe(true);
  });

  it("refuses missing or malformed headers instead of throwing", () => {
    expect(verifySignature(SECRET, { id: "", timestamp: NOW_SECONDS, signature: sign("", NOW_SECONDS, BODY) }, BODY, NOW)).toBe(
      false,
    );
    expect(verifySignature(SECRET, headers({ timestamp: "soon" }), BODY, NOW)).toBe(false);
    expect(verifySignature(SECRET, headers({ signature: "" }), BODY, NOW)).toBe(false);
    expect(verifySignature(SECRET, headers({ signature: "v1," }), BODY, NOW)).toBe(false);
    expect(verifySignature(SECRET, headers({ signature: "garbage" }), BODY, NOW)).toBe(false);
  });

  it("refuses a signature of another version", () => {
    const v2 = sign("msg_1", NOW_SECONDS, BODY).replace(/^v1,/, "v2,");
    expect(verifySignature(SECRET, headers({ signature: v2 }), BODY, NOW)).toBe(false);
  });
});
