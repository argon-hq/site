import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { IS_PUBLIC } from "./public.decorator";

// Global guard: every route, including Mastra's, requires the internal secret unless marked @Public.
@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly secret: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const header = context.switchToHttp().getRequest<Request>().header("x-internal-secret") ?? "";
    if (!safeEqual(header, this.secret)) throw new UnauthorizedException();
    return true;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
