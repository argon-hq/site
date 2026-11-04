import type { Request } from "express";
import { isIP } from "node:net";

// Who is calling a public subscriber route. The static site calls them from the visitor's browser,
// so what the request carries about the visitor (address, user agent) is the visitor's own. Nothing
// in the body speaks for the visitor: anyone could put any address there.
export type Visitor = { ip?: string; userAgent?: string };

export function visitorOf(req: Request): Visitor {
  const ip = typeof req.ip === "string" && isIP(req.ip) !== 0 ? req.ip : undefined;
  const userAgent = req.header("user-agent")?.slice(0, 500);
  return { ip, userAgent };
}
