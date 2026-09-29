import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { STUDIO_BOOTSTRAP_PATH } from "../studio/studio.paths";
import { IS_PUBLIC } from "./public.decorator";

// Global guard: every route, including Mastra's, requires the internal secret unless marked @Public.
@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly secret: string,
    // Where the Studio is served, its bootstrap route answers without the secret. See studio.paths.
    private readonly studioEnabled = false,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (this.studioEnabled && request.method === "GET" && request.path === STUDIO_BOOTSTRAP_PATH) return true;
    const header = request.header("x-internal-secret") ?? "";
    if (!safeEqual(header, this.secret)) throw new UnauthorizedException();
    return true;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
