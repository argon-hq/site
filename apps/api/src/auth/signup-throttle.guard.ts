import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { isIP } from "node:net";

// How many sign-ups one address may start per minute. The per-e-mail window in the subscriber
// service protects one inbox from a repeated click; this protects the list from one client feeding
// it strangers' addresses, and the Resend quota from paying for them.
export const SIGNUP_LIMIT = { ttl: 60_000, limit: 10 };

// The site's server action is what calls POST /subscriber, so the socket address is always the web
// container's. The visitor's address travels in the body as `consentIp` — the same value the row
// keeps as proof of opt-in — and that is what the limit counts. A public route with no body, such as
// the one-click unsubscribe, is counted by the socket address the proxy hands over.
@Injectable()
export class SignupThrottleGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const body = req.body as { consentIp?: unknown } | undefined;
    const fromBody = typeof body?.consentIp === "string" && isIP(body.consentIp) !== 0 ? body.consentIp : null;
    return fromBody ?? (typeof req.ip === "string" ? req.ip : "unknown");
  }
}
