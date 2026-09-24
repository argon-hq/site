import { ExecutionContext, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { InternalSecretGuard, safeEqual } from "./internal-secret.guard";
import { Public } from "./public.decorator";
import { STUDIO_BOOTSTRAP_PATH } from "../studio/studio.paths";

describe("safeEqual", () => {
  it("matches identical secrets and rejects different ones", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "")).toBe(false);
  });
});

const secret = "0123456789abcdef";

class Routes {
  @Public()
  ours() {}

  // What @mastra/nestjs puts on its own /health, /ready and /info.
  @SetMetadata("isPublic", true)
  theirs() {}

  guarded() {}
}

type Call = { handler?: () => void; method?: string; path?: string; secret?: string };

function context({
  handler = Routes.prototype.guarded,
  method = "GET",
  path = "/mastra/agents",
  secret: header,
}: Call): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        path,
        header: (name: string) => (name === "x-internal-secret" ? header : undefined),
      }),
    }),
  } as unknown as ExecutionContext;
}

describe("InternalSecretGuard", () => {
  const guard = (studioEnabled: boolean) => new InternalSecretGuard(new Reflector(), secret, studioEnabled);

  it("takes the secret and refuses everything else", () => {
    expect(guard(false).canActivate(context({ secret }))).toBe(true);
    expect(() => guard(false).canActivate(context({}))).toThrow();
    expect(() => guard(false).canActivate(context({ secret: "wrong" }))).toThrow();
  });

  it("lets a route we marked @Public through without the header", () => {
    expect(guard(false).canActivate(context({ handler: Routes.prototype.ours }))).toBe(true);
  });

  // The reason @Public keys its metadata on a symbol: Mastra marks the system routes it registers
  // under our global guard with a key named "isPublic", and a string key would exempt them too.
  it("still asks the secret of a route Mastra marked public", () => {
    expect(() => guard(false).canActivate(context({ handler: Routes.prototype.theirs }))).toThrow(UnauthorizedException);
    expect(guard(false).canActivate(context({ handler: Routes.prototype.theirs, secret }))).toBe(true);
  });

  // The Studio cannot send the secret on its first call, so this one route opens where it is served.
  it("opens the Studio bootstrap route only where the Studio is served", () => {
    expect(guard(true).canActivate(context({ path: STUDIO_BOOTSTRAP_PATH }))).toBe(true);
    expect(() => guard(false).canActivate(context({ path: STUDIO_BOOTSTRAP_PATH }))).toThrow();
  });

  it("opens it for reading only, and for nothing near it", () => {
    expect(() => guard(true).canActivate(context({ method: "POST", path: STUDIO_BOOTSTRAP_PATH }))).toThrow();
    expect(() => guard(true).canActivate(context({ path: `${STUDIO_BOOTSTRAP_PATH}/x` }))).toThrow();
    expect(() => guard(true).canActivate(context({ path: "/mastra/auth" }))).toThrow();
  });
});
