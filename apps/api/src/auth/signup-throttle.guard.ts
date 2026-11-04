import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

// How many sign-ups one address may start per minute. The per-e-mail window in the subscriber
// service protects one inbox from a repeated click; this protects the list from one client feeding
// it strangers' addresses, and the Resend quota from paying for them.
export const SIGNUP_LIMIT = { ttl: 60_000, limit: 10 };

// Who the limit counts. Every call comes from the visitor's browser, through CloudFront: counted by
// its address (req.ip, from CloudFront-Viewer-Address, src/net/cloudfront.ts), whatever the body or
// the headers say.
@Injectable()
export class SignupThrottleGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    return typeof request.ip === "string" ? request.ip : "unknown";
  }
}
