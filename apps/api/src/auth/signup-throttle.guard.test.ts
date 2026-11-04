import type { ExecutionContext } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SignupThrottleGuard } from "./signup-throttle.guard";

// The tracker is what the limit counts by; the counting itself is the library's.
class Exposed extends SignupThrottleGuard {
  track(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }
  skip(req: Record<string, unknown>): Promise<boolean> {
    return this.shouldSkip({ switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext);
  }
}

const SECRET = "s".repeat(24);
const guard = () => new Exposed({ throttlers: [] }, {} as never, {} as never);

function req(ip: string, body?: unknown, secret?: string): Record<string, unknown> {
  return { ip, body, header: (name: string) => (name === "x-internal-secret" ? secret : undefined) };
}

describe("SignupThrottleGuard", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.INTERNAL_API_SECRET = previous;
  });

  it("counts a browser by its own address, whatever the body says", async () => {
    expect(await guard().track(req("203.0.113.7", { consentIp: "198.51.100.1" }))).toBe("203.0.113.7");
    expect(await guard().skip(req("203.0.113.7"))).toBe(false);
  });

  it("counts the EC2 site's call by the visitor's address it sends", async () => {
    expect(await guard().track(req("10.0.0.2", { consentIp: "203.0.113.7" }, SECRET))).toBe("203.0.113.7");
    expect(await guard().skip(req("10.0.0.2", { consentIp: "203.0.113.7" }, SECRET))).toBe(false);
  });

  it("does not count the EC2 site's call that names no visitor, nor one with a bad address", async () => {
    expect(await guard().skip(req("10.0.0.2", {}, SECRET))).toBe(true);
    expect(await guard().skip(req("10.0.0.2", { consentIp: "not-an-ip" }, SECRET))).toBe(true);
  });

  it("treats a wrong secret as a browser", async () => {
    expect(await guard().track(req("203.0.113.7", { consentIp: "198.51.100.1" }, "wrong"))).toBe("203.0.113.7");
  });
});
