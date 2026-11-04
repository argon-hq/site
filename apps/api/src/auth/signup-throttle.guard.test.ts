import { describe, expect, it } from "vitest";
import { SignupThrottleGuard } from "./signup-throttle.guard";

// The tracker is what the limit counts by; the counting itself is the library's.
class Exposed extends SignupThrottleGuard {
  track(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }
}

const guard = () => new Exposed({ throttlers: [] }, {} as never, {} as never);

function req(ip: unknown, body?: unknown, secret?: string): Record<string, unknown> {
  return { ip, body, header: (name: string) => (name === "x-internal-secret" ? secret : undefined) };
}

describe("SignupThrottleGuard", () => {
  it("counts a call by its own address, whatever the body says", async () => {
    expect(await guard().track(req("203.0.113.7", { consentIp: "198.51.100.1" }))).toBe("203.0.113.7");
  });

  it("counts a call with the internal secret by its own address too", async () => {
    expect(await guard().track(req("10.0.0.2", { consentIp: "203.0.113.7" }, "s".repeat(24)))).toBe("10.0.0.2");
  });

  it("counts a call without an address under one name", async () => {
    expect(await guard().track(req(undefined))).toBe("unknown");
  });
});
