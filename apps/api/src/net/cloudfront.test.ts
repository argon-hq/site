import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { cloudFrontOrigin, viewerIp } from "./cloudfront";

const SECRET = "s".repeat(40);

function call(path: string, headers: Record<string, string>) {
  const req = { path, header: (name: string) => headers[name.toLowerCase()], ip: "10.0.0.1" } as unknown as Request;
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  cloudFrontOrigin(SECRET)(req, res, next);
  return { req, res, next, json };
}

describe("the visitor's address from CloudFront", () => {
  it("is the part before the port", () => {
    expect(viewerIp("203.0.113.7:46532")).toBe("203.0.113.7");
    expect(viewerIp("2001:db8::1:46532")).toBe("2001:db8::1");
  });

  it("is nothing when the header is missing or is not an address", () => {
    expect(viewerIp(undefined)).toBeNull();
    expect(viewerIp("not-an-ip:80")).toBeNull();
  });
});

describe("a request to the API function", () => {
  it("passes with the secret, and its ip becomes the visitor's", () => {
    const { req, next } = call("/subscriber", {
      "x-origin-verify": SECRET,
      "cloudfront-viewer-address": "203.0.113.7:46532",
    });
    expect(next).toHaveBeenCalledOnce();
    expect(req.ip).toBe("203.0.113.7");
  });

  it("is refused without the secret, or with a wrong one", () => {
    for (const headers of [{}, { "x-origin-verify": "wrong" }]) {
      const { res, next } = call("/subscriber/unsubscribe/one-click", headers);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("reaches /health/live without the secret, for the keep-warm schedule", () => {
    const { next } = call("/health/live", {});
    expect(next).toHaveBeenCalledOnce();
  });
});
