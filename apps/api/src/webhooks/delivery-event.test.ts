import { describe, expect, it } from "vitest";
import { parseEvent, transitionFor } from "./delivery-event";

const event = (type: string, data: Record<string, unknown> = {}) => ({
  type,
  created_at: "2026-11-13T10:00:00.000Z",
  data: { email_id: "re_1", to: ["ana@example.com"], ...data },
});

describe("parseEvent", () => {
  it("reads the type and the provider's id of the message", () => {
    expect(parseEvent(event("email.delivered"))).toEqual({ type: "email.delivered", emailId: "re_1" });
  });

  it("reads the kind of a bounce", () => {
    expect(parseEvent(event("email.bounced", { bounce: { type: "Permanent", subType: "General", message: "x" } }))).toEqual(
      { type: "email.bounced", emailId: "re_1", bounceType: "Permanent" },
    );
  });

  it("returns null for anything that is not an e-mail event the provider could send", () => {
    expect(parseEvent({ type: "contact.created", data: { id: "c_1" } })).toBeNull();
    expect(parseEvent({ type: "email.delivered", data: {} })).toBeNull();
    expect(parseEvent("not an object")).toBeNull();
    expect(parseEvent(null)).toBeNull();
  });
});

describe("transitionFor", () => {
  it("delivered moves a sent row only", () => {
    expect(transitionFor({ type: "email.delivered", emailId: "re_1" })).toEqual({ to: "delivered", from: ["sent"] });
  });

  it("a permanent bounce is hard, and can follow a delivery the receiving server later returned", () => {
    expect(transitionFor({ type: "email.bounced", emailId: "re_1", bounceType: "Permanent" })).toEqual({
      to: "hard_bounce",
      from: ["sent", "delivered", "soft_bounce"],
    });
  });

  it("a transient or undetermined bounce is soft: the address is not given up on one", () => {
    for (const bounceType of ["Transient", "Undetermined", undefined]) {
      expect(transitionFor({ type: "email.bounced", emailId: "re_1", bounceType })).toEqual({
        to: "soft_bounce",
        from: ["sent"],
      });
    }
  });

  it("a complaint wins over every other outcome of a message that left", () => {
    expect(transitionFor({ type: "email.complained", emailId: "re_1" })).toEqual({
      to: "complaint",
      from: ["sent", "delivered", "soft_bounce", "hard_bounce"],
    });
  });

  it("a suppressed address is treated as a hard bounce: the provider will not deliver to it", () => {
    expect(transitionFor({ type: "email.suppressed", emailId: "re_1" })).toEqual({
      to: "hard_bounce",
      from: ["sent", "delivered", "soft_bounce"],
    });
  });

  it("a message the provider failed to send is failed", () => {
    expect(transitionFor({ type: "email.failed", emailId: "re_1" })).toEqual({ to: "failed", from: ["sent"] });
  });

  it("no status for events that say nothing final about the delivery", () => {
    for (const type of ["email.sent", "email.delivery_delayed", "email.opened", "email.clicked", "email.scheduled"]) {
      expect(transitionFor({ type, emailId: "re_1" })).toBeNull();
    }
  });

  it("never moves a row back: no final status is a source of a weaker one", () => {
    const rank = ["pending", "sent", "delivered", "soft_bounce", "hard_bounce", "complaint"];
    for (const type of ["email.delivered", "email.bounced", "email.complained", "email.suppressed"]) {
      for (const bounceType of ["Permanent", "Transient"]) {
        const transition = transitionFor({ type, emailId: "re_1", bounceType });
        if (!transition) continue;
        for (const from of transition.from) expect(rank.indexOf(from)).toBeLessThan(rank.indexOf(transition.to));
      }
    }
  });
});
