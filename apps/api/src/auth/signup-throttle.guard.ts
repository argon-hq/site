import { type ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import { isIP } from "node:net";
import { isInternalCall } from "./internal-call";

// How many sign-ups one address may start per minute. The per-e-mail window in the subscriber
// service protects one inbox from a repeated click; this protects the list from one client feeding
// it strangers' addresses, and the Resend quota from paying for them.
export const SIGNUP_LIMIT = { ttl: 60_000, limit: 10 };

// Who the limit counts (src/auth/internal-call.ts). A call from the browser, through CloudFront, is
// the visitor's own: counted by its address (req.ip, from CloudFront-Viewer-Address). A call with
// the internal secret comes from the EC2 site's server actions, all from one container: it is
// counted by the visitor's address it sends in the body, and not at all when it sends none — the
// confirmation and the unsubscribe page carry none, and one counter for every visitor would cap
// the whole site at ten a minute.
@Injectable()
export class SignupThrottleGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    return isInternalCall(req) && bodyIp(req) === null;
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    if (isInternalCall(request)) return bodyIp(request) ?? "internal";
    return typeof request.ip === "string" ? request.ip : "unknown";
  }
}

function bodyIp(req: Request): string | null {
  const body = req.body as { consentIp?: unknown } | undefined;
  return typeof body?.consentIp === "string" && isIP(body.consentIp) !== 0 ? body.consentIp : null;
}
