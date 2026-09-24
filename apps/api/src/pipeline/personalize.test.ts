import { describe, expect, it } from "vitest";
import { UNSUBSCRIBE_PLACEHOLDER } from "../subscriber/urls";
import { personalize, sendRefusal, SUBSTITUTES_UNSUBSCRIBE_TOKEN } from "./personalize";

const edition = {
  html: `<a href="https://argon.com.br/newsletter/unsubscribe?token=${UNSUBSCRIBE_PLACEHOLDER}">sair</a>`,
  text: `Cancele a assinatura: https://argon.com.br/newsletter/unsubscribe?token=${UNSUBSCRIBE_PLACEHOLDER}`,
};

describe("personalize", () => {
  it("hands the stored edition over untouched while the unsubscribe token is still a placeholder", () => {
    expect(personalize(edition)).toEqual({
      outcome: "ready",
      html: edition.html,
      text: edition.text,
      headers: {},
    });
  });

  it("announces no one-click unsubscribe, because a URI carrying the placeholder would swallow the request", () => {
    const copy = personalize(edition);

    // A mail client posts the announced URI on its own and tells the subscriber they are out. With
    // the placeholder the lookup fails and the request is lost, which is worse than no header.
    expect(copy.outcome === "ready" && copy.headers).toEqual({});
  });

  it("still says the substitution has not landed, which is what keeps the production guard shut", () => {
    // The point of this test is to make ARG-114 change the line consciously.
    expect(SUBSTITUTES_UNSUBSCRIBE_TOKEN).toBe(false);
  });
});

describe("sendRefusal", () => {
  it("never lets production send while the message still carries the placeholder", () => {
    expect(sendRefusal("prod", false)).toContain("ARG-114");
  });

  it.each(["local", "lab", "dev"] as const)("lets %s send, so the pipeline can be exercised end to end", (where) => {
    expect(sendRefusal(where, false)).toBeNull();
  });

  it("stops refusing the moment the substitution lands", () => {
    expect(sendRefusal("prod", true)).toBeNull();
  });
});
