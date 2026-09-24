import { describe, expect, it } from "vitest";
import { unsubscribeTokenFor, verifyUnsubscribeToken } from "../subscriber/token";
import { UNSUBSCRIBE_PLACEHOLDER, unsubscribeOneClickUrl } from "../subscriber/urls";
import { personalize } from "./personalize";

const origins = { web: "https://argon.example", api: "https://api.argon.example" };
const secret = "0123456789abcdef0123456789abcdef";
const recipient = { subscriberId: "5f7c2a1e-9b3d-4c6e-8a2f-1d3e5b7c9a0f", email: "joao@example.com" };

const edition = {
  html: `<a href="${origins.web}/newsletter/unsubscribe?token=${UNSUBSCRIBE_PLACEHOLDER}">sair</a>`,
  text: `Cancele a assinatura: ${origins.web}/newsletter/unsubscribe?token=${UNSUBSCRIBE_PLACEHOLDER}`,
};

describe("personalize", () => {
  it("puts the subscriber's own token where the marker was, in both copies", () => {
    const copy = personalize(edition, recipient, origins, secret);
    const token = unsubscribeTokenFor(secret, recipient.subscriberId);

    expect(copy.outcome).toBe("ready");
    if (copy.outcome !== "ready") return;
    expect(copy.html).toContain(`token=${encodeURIComponent(token)}`);
    expect(copy.text).toContain(`token=${encodeURIComponent(token)}`);
    expect(copy.html).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(copy.text).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
    // The token in the copy is the one the API will accept.
    expect(verifyUnsubscribeToken(secret, token)).toBe(recipient.subscriberId);
  });

  it("announces one-click unsubscribe with the same token", () => {
    const copy = personalize(edition, recipient, origins, secret);
    const token = unsubscribeTokenFor(secret, recipient.subscriberId);

    expect(copy.outcome === "ready" && copy.headers["List-Unsubscribe"]).toBe(`<${unsubscribeOneClickUrl(origins, token)}>`);
    expect(copy.outcome === "ready" && copy.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("gives two subscribers two different tokens", () => {
    const a = personalize(edition, recipient, origins, secret);
    const b = personalize(edition, { ...recipient, subscriberId: "0a1b2c3d-0000-4000-8000-000000000000" }, origins, secret);
    expect(a.outcome === "ready" && b.outcome === "ready" && a.html).not.toBe(b.outcome === "ready" && b.html);
  });

  it("refuses a stored edition with no place for the token", () => {
    const copy = personalize({ html: "<p>sem link</p>", text: "sem link" }, recipient, origins, secret);
    expect(copy.outcome).toBe("unpersonalizable");
  });
});
