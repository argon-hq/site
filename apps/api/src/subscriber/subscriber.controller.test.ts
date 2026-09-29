import { NotFoundException, RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, HEADERS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { IS_PUBLIC } from "../auth/public.decorator";
import { SignupThrottleGuard } from "../auth/signup-throttle.guard";
import { SubscriberController } from "./subscriber.controller";
import type { SubscriberService } from "./subscriber.service";
import { unsubscribeHeaders } from "./urls";

// The cancellation policies of ARG-49 are decorators, not logic: what these tests read is the route
// table Nest builds from them, so a policy dropped in a refactor fails here instead of in an inbox.
const proto = SubscriberController.prototype;
const handlers = Object.getOwnPropertyNames(proto).filter((name) => name !== "constructor") as (keyof typeof proto)[];
const meta = (key: string | symbol, name: keyof typeof proto) => Reflect.getMetadata(key, proto[name]) as unknown;

const origins = { web: "https://argon.example", api: "https://api.argon.example", assets: "https://argon.example" };
const TOKEN = "a".repeat(20);

function controller() {
  const subscribers = {
    unsubscribe: vi.fn(() => Effect.succeed({ status: "cancelled", email: "ana@example.com" } as const)),
    findByUnsubscribeToken: vi.fn(() => Effect.succeed({ email: "ana@example.com", status: "confirmed" })),
  };
  return { subscribers, route: new SubscriberController(subscribers as unknown as SubscriberService) };
}

describe("one-click unsubscribe (RFC 8058)", () => {
  it("is a POST on the very path the List-Unsubscribe header announces", () => {
    const headers = unsubscribeHeaders(origins, TOKEN);
    const announced = new URL(headers["List-Unsubscribe"]!.slice(1, -1));
    const controllerPath = Reflect.getMetadata(PATH_METADATA, SubscriberController) as string;

    expect(announced.origin).toBe(origins.api);
    expect(`/${controllerPath}/${meta(PATH_METADATA, "oneClick") as string}`).toBe(announced.pathname);
    expect(meta(METHOD_METADATA, "oneClick")).toBe(RequestMethod.POST);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("needs no secret and is the only public route of the subscriber controller", () => {
    expect(handlers.filter((name) => meta(IS_PUBLIC, name) === true)).toEqual(["oneClick"]);
  });

  it("is rate limited, being open to the internet", () => {
    expect(meta(GUARDS_METADATA, "oneClick")).toEqual([SignupThrottleGuard]);
  });

  it("cancels with a valid token and answers ok", async () => {
    const { route, subscribers } = controller();

    await expect(route.oneClick(TOKEN)).resolves.toEqual({ status: "ok" });
    expect(subscribers.unsubscribe).toHaveBeenCalledWith(TOKEN);
  });

  it("answers ok to a token that cannot be one, so the mail client does not retry", async () => {
    const { route, subscribers } = controller();

    await expect(route.oneClick("short")).resolves.toEqual({ status: "ok" });
    await expect(route.oneClick(undefined as unknown as string)).resolves.toEqual({ status: "ok" });
    expect(subscribers.unsubscribe).not.toHaveBeenCalled();
  });
});

describe("routes that carry a token", () => {
  it.each(["confirm", "lookup", "unsubscribe", "oneClick"] as const)(
    "%s sends Referrer-Policy: no-referrer, so the token does not leak in the Referer",
    (name) => {
      expect(meta(HEADERS_METADATA, name)).toContainEqual({ name: "Referrer-Policy", value: "no-referrer" });
    },
  );
});

describe("the page lookup", () => {
  it("is a GET that only reads: opening the link never cancels", async () => {
    const { route, subscribers } = controller();

    expect(meta(METHOD_METADATA, "lookup")).toBe(RequestMethod.GET);
    await expect(route.lookup(TOKEN)).resolves.toEqual({ email: "ana@example.com", status: "confirmed" });
    expect(subscribers.unsubscribe).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed token, without asking the database", async () => {
    const { route, subscribers } = controller();

    await expect(route.lookup("short")).rejects.toBeInstanceOf(NotFoundException);
    expect(subscribers.findByUnsubscribeToken).not.toHaveBeenCalled();
  });

  it("answers 404 for a token nobody holds", async () => {
    const { route, subscribers } = controller();
    subscribers.findByUnsubscribeToken.mockReturnValueOnce(Effect.succeed(null as never));

    await expect(route.lookup(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("cancels only through the POST", () => {
    expect(meta(METHOD_METADATA, "unsubscribe")).toBe(RequestMethod.POST);
  });
});
