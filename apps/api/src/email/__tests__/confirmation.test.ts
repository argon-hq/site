import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { buildConfirmation } from "../confirmation/build";
import { confirmationFixture } from "../fixtures/confirmation";
import { limits } from "../theme";
import type { ConfirmationInput } from "../types";

const build = (input: ConfirmationInput = confirmationFixture) => Effect.runPromise(buildConfirmation(input));

describe("buildConfirmation", () => {
  it("is deterministic: same input, same output", async () => {
    expect(await build()).toEqual(await build());
  });

  it("reproduces the fixture HTML", async () => {
    expect((await build()).html).toMatchSnapshot();
  });

  it("reproduces the fixture plain text", async () => {
    expect((await build()).text).toMatchSnapshot();
  });

  it("carries the confirmation link in both versions", async () => {
    const built = await build();
    // The button is not enough: a client that blocks it still has to be able to confirm.
    expect(built.html.split(confirmationFixture.confirmUrl).length - 1).toBeGreaterThanOrEqual(2);
    expect(built.text).toContain(confirmationFixture.confirmUrl);
  });

  it("says how long the link lasts, in both versions", async () => {
    const built = await build({ ...confirmationFixture, expiresInHours: 48 });
    expect(built.html).toContain("48 horas");
    expect(built.text).toContain("48 horas");
  });

  it("carries the postal address and the policy, which the law requires", async () => {
    const built = await build();
    expect(built.html).toContain(confirmationFixture.sender.postalAddress);
    expect(built.text).toContain(confirmationFixture.sender.postalAddress);
    expect(built.html).toContain(confirmationFixture.privacyPolicyUrl);
    expect(built.text).toContain(confirmationFixture.privacyPolicyUrl);
  });

  it("has no unsubscribe link: there is no subscription to cancel yet", async () => {
    const built = await build();
    expect(built.html).not.toContain("unsubscribe");
    expect(built.text.toLowerCase()).not.toContain("cancele a assinatura");
  });

  it("stays well under the size clients clip at", async () => {
    expect(Buffer.byteLength((await build()).html)).toBeLessThan(limits.htmlMaxBytes);
  });

  it("wraps the plain text at the column limit, except the link", async () => {
    const built = await build();
    for (const line of built.text.split("\n")) {
      if (line.includes("http")) continue;
      expect(line.length).toBeLessThanOrEqual(78);
    }
  });
});
