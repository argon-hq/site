import { describe, expect, it } from "vitest";
import { SignupThrottleGuard } from "./signup-throttle.guard";

// The tracker is what the limit counts by; the counting itself is the library's.
class Exposed extends SignupThrottleGuard {
  track(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }
}

const guard = () => new Exposed({ throttlers: [] }, {} as never, {} as never);

describe("SignupThrottleGuard", () => {
  it("counts by the visitor's address when the body carries one", async () => {
    expect(await guard().track({ ip: "10.0.0.2", body: { consentIp: "203.0.113.7" } })).toBe("203.0.113.7");
  });

  it("falls back to the socket address when the body has no valid address", async () => {
    expect(await guard().track({ ip: "10.0.0.2", body: { consentIp: "not-an-ip" } })).toBe("10.0.0.2");
    expect(await guard().track({ ip: "10.0.0.2" })).toBe("10.0.0.2");
  });
});
