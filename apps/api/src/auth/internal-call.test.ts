import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { visitorOf } from "./internal-call";

function request(headers: Record<string, string>, ip?: string): Request {
  return { ip, header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

describe("the visitor of a public subscriber route", () => {
  it("is the request's own address and user agent", () => {
    expect(visitorOf(request({ "user-agent": "Firefox" }, "203.0.113.7"))).toEqual({
      ip: "203.0.113.7",
      userAgent: "Firefox",
    });
  });

  it("is the request's own even when it carries the internal secret", () => {
    const req = request({ "x-internal-secret": "s".repeat(24), "user-agent": "node" }, "10.0.0.5");
    expect(visitorOf(req)).toEqual({ ip: "10.0.0.5", userAgent: "node" });
  });

  it("has no address when the request's is not one, and a bounded user agent", () => {
    expect(visitorOf(request({ "user-agent": "x".repeat(600) }, "not-an-ip"))).toEqual({
      ip: undefined,
      userAgent: "x".repeat(500),
    });
  });
});
