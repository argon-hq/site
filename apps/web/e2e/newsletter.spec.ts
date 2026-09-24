import { expect, test } from "@playwright/test";
import messages from "../messages/pt-BR.json";

const text = messages.newsletter;

test.describe("newsletter sign-up", () => {
  test("validates on the client and reports the API error", async ({ page }) => {
    await page.goto("/newsletter");

    const email = page.getByRole("textbox", { name: text.emailLabel });
    const consent = page.getByRole("checkbox");
    const submit = page.getByRole("button", { name: text.submit });
    // Scoped to the form: Next's route announcer is a role="alert" too.
    const alert = page.locator("form").getByRole("alert");

    await submit.click();
    await expect(alert).toHaveText(text.errors.required);

    await email.fill("ana@example");
    await submit.click();
    await expect(alert).toHaveText(text.errors.invalid);

    await email.fill("ana@example.com");
    await submit.click();
    await expect(alert).toHaveText(text.errors.consent);

    // The web server points API_URL at a closed port, so the action fails.
    await consent.check();
    await submit.click();
    await expect(alert).toHaveText(text.errors.unexpected);
    await expect(email).toHaveValue("ana@example.com");
  });

  test("has the main landmark and a working skip link", async ({ page }) => {
    await page.goto("/newsletter");

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: messages.common.skipToContent });
    await expect(skip).toBeFocused();
    await expect(page.locator("main#main-content")).toHaveCount(1);
  });
});

test.describe("unsubscribe", () => {
  test("shows the invalid link state for a malformed token", async ({ page }) => {
    await page.goto("/newsletter/unsubscribe?token=abc");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      messages.unsubscribe.invalid.heading,
    );
    await expect(page.getByRole("link", { name: messages.unsubscribe.invalid.cta })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
