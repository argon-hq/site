import type { Request } from "express";
import { isIP } from "node:net";
import { safeEqual } from "./internal-secret.guard";

// Who is calling a public subscriber route. The static site calls them from the visitor's browser,
// so what the request carries about the visitor (address, user agent) is the visitor's own. Until
// the site leaves the EC2, its server actions call them too, with the internal secret, and send the
// visitor's address in the body because the request itself comes from the web container. Only a
// call with the secret may speak for someone else: anyone else could put any address in the body.
export function isInternalCall(req: Request): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  return Boolean(secret) && safeEqual(req.header("x-internal-secret") ?? "", secret as string);
}

export type Visitor = { ip?: string; userAgent?: string };

export function visitorOf(req: Request, body?: { consentIp?: string; consentUserAgent?: string }): Visitor {
  if (isInternalCall(req)) return { ip: body?.consentIp, userAgent: body?.consentUserAgent };
  const ip = typeof req.ip === "string" && isIP(req.ip) !== 0 ? req.ip : undefined;
  const userAgent = req.header("user-agent")?.slice(0, 500);
  return { ip, userAgent };
}
