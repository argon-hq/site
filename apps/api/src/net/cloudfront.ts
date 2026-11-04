import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";

// On Lambda the API answers through CloudFront (deploy/aws/api_cdn.tf), and its function URL is
// public: anyone who finds it can skip CloudFront, and with it the one header that says who the
// visitor is. CloudFront adds two headers to every request it forwards:
//
// - x-origin-verify: a secret only CloudFront and the function know. A request without it did not
//   come through CloudFront and is refused — except /health/live, which the keep-warm schedule
//   calls straight on the function.
// - CloudFront-Viewer-Address: "<ip>:<port>" of the visitor, written by CloudFront itself. It
//   becomes `req.ip`, which the rate limits count by, instead of whatever X-Forwarded-For says.
//
// Only mounted where ORIGIN_VERIFY_SECRET is set (the API function); the EC2 keeps Caddy's trust.

export const ORIGIN_HEADER = "x-origin-verify";
const VIEWER_HEADER = "cloudfront-viewer-address";
const OPEN_PATHS = new Set(["/health/live"]);

// "203.0.113.7:46532" or "2001:db8::1:46532": the port is after the last colon.
export function viewerIp(header: string | undefined): string | null {
  if (!header) return null;
  const ip = header.slice(0, header.lastIndexOf(":"));
  return isIP(ip) !== 0 ? ip : null;
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function cloudFrontOrigin(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (OPEN_PATHS.has(req.path)) return next();
    if (!same(req.header(ORIGIN_HEADER) ?? "", secret)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const ip = viewerIp(req.header(VIEWER_HEADER));
    if (ip) Object.defineProperty(req, "ip", { value: ip, configurable: true });
    next();
  };
}
