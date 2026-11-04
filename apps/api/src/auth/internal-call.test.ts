import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInternalCall, visitorOf } from "./internal-call";

const SECRET = "s".repeat(24);

function request(headers: Record<string, string>, ip = "203.0.113.7"): Request {
  return { ip, header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

describe("the visitor of a public subscriber route", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.INTERNAL_API_SECRET = previous;
  });

  it("is the request's own when it comes from a browser", () => {
    const req = request({ "user-agent": "Firefox" });
    expect(isInternalCall(req)).toBe(false);
    expect(visitorOf(req, { consentIp: "198.51.100.1", consentUserAgent: "forged" })).toEqual({
      ip: "203.0.113.7",
      userAgent: "Firefox",
    });
  });

  it("is what the body says when the EC2 site calls with the secret", () => {
    const req = request({ "x-internal-secret": SECRET, "user-agent": "node" }, "10.0.0.5");
    expect(isInternalCall(req)).toBe(true);
    expect(visitorOf(req, { consentIp: "198.51.100.1", consentUserAgent: "Safari" })).toEqual({
      ip: "198.51.100.1",
      userAgent: "Safari",
    });
  });

  it("does not trust a wrong secret", () => {
    expect(isInternalCall(request({ "x-internal-secret": "wrong" }))).toBe(false);
  });
});
