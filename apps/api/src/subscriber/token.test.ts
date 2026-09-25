import { describe, expect, it } from "vitest";
import { createConfirmationToken, hashToken, unsubscribeTokenFor, verifyUnsubscribeToken } from "./token";

const secret = "0123456789abcdef0123456789abcdef";
const id = "5f7c2a1e-9b3d-4c6e-8a2f-1d3e5b7c9a0f";

describe("unsubscribe token", () => {
  it("is the same every time for the same subscriber, and names them", () => {
    const token = unsubscribeTokenFor(secret, id);
    expect(unsubscribeTokenFor(secret, id)).toBe(token);
    expect(token.startsWith(`${id}.`)).toBe(true);
    expect(verifyUnsubscribeToken(secret, token)).toBe(id);
  });

  it("refuses a token signed with another secret, a tampered id and garbage", () => {
    const token = unsubscribeTokenFor(secret, id);
    expect(verifyUnsubscribeToken("another-secret-of-thirty-two-chars", token)).toBeNull();
    expect(verifyUnsubscribeToken(secret, token.replace(id, "0a1b2c3d-0000-4000-8000-000000000000"))).toBeNull();
    expect(verifyUnsubscribeToken(secret, "no-dot-here")).toBeNull();
    expect(verifyUnsubscribeToken(secret, ".")).toBeNull();
    expect(verifyUnsubscribeToken(secret, `${id}.`)).toBeNull();
  });

  it("fits the bounds the routes accept and survives a query string untouched", () => {
    const token = unsubscribeTokenFor(secret, id);
    expect(token.length).toBeGreaterThanOrEqual(20);
    expect(token.length).toBeLessThanOrEqual(100);
    expect(encodeURIComponent(token)).toBe(token);
  });
});

describe("confirmation token", () => {
  it("expires in 48 hours and is stored only as a hash", () => {
    const now = new Date("2026-09-24T10:00:00Z");
    const token = createConfirmationToken(now);
    expect(token.expiresAt.toISOString()).toBe("2026-09-26T10:00:00.000Z");
    expect(token.hash).toBe(hashToken(token.token));
    expect(token.hash).not.toBe(token.token);
  });
});
