import { describe, expect, it } from "vitest";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { InternalSecretGuard, safeEqual } from "./internal-secret.guard";
import { STUDIO_BOOTSTRAP_PATH } from "../studio/studio.paths";

describe("safeEqual", () => {
  it("matches identical secrets and rejects different ones", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "")).toBe(false);
  });
});

const secret = "0123456789abcdef";

function context(request: { method: string; path: string; secret?: string }): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({
        method: request.method,
        path: request.path,
        header: (name: string) => (name === "x-internal-secret" ? request.secret : undefined),
      }),
    }),
  } as unknown as ExecutionContext;
}

describe("InternalSecretGuard", () => {
  const guard = (studioEnabled: boolean) => new InternalSecretGuard(new Reflector(), secret, studioEnabled);

  it("takes the secret and refuses everything else", () => {
    expect(guard(false).canActivate(context({ method: "GET", path: "/mastra/agents", secret }))).toBe(true);
    expect(() => guard(false).canActivate(context({ method: "GET", path: "/mastra/agents" }))).toThrow();
    expect(() => guard(false).canActivate(context({ method: "GET", path: "/mastra/agents", secret: "wrong" }))).toThrow();
  });

  // The Studio cannot send the secret on its first call, so this one route opens where it is served.
  it("opens the Studio bootstrap route only where the Studio is served", () => {
    expect(guard(true).canActivate(context({ method: "GET", path: STUDIO_BOOTSTRAP_PATH }))).toBe(true);
    expect(() => guard(false).canActivate(context({ method: "GET", path: STUDIO_BOOTSTRAP_PATH }))).toThrow();
  });

  it("opens it for reading only, and for nothing near it", () => {
    expect(() => guard(true).canActivate(context({ method: "POST", path: STUDIO_BOOTSTRAP_PATH }))).toThrow();
    expect(() => guard(true).canActivate(context({ method: "GET", path: `${STUDIO_BOOTSTRAP_PATH}/x` }))).toThrow();
    expect(() => guard(true).canActivate(context({ method: "GET", path: "/mastra/auth" }))).toThrow();
  });
});
