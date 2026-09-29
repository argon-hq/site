import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribe } from "@/actions/subscribe";
import { messages, renderWithIntl } from "@/test/render";
import { NewsletterForm } from "./newsletter-form";

vi.mock("@/actions/subscribe", () => ({ subscribe: vi.fn() }));

const subscribeMock = vi.mocked(subscribe);
const text = messages.newsletter;

function setup() {
  const user = userEvent.setup();
  const view = renderWithIntl(<NewsletterForm />);
  const email = screen.getByRole("textbox", { name: text.emailLabel });
  const consent = screen.getByRole("checkbox");
  const submit = screen.getByRole("button", { name: text.submit });
  return { user, view, email, consent, submit };
}

describe("NewsletterForm", () => {
  beforeEach(() => {
    subscribeMock.mockReset();
  });

  it("asks for the email when it is empty", async () => {
    const { user, submit } = setup();

    await user.click(submit);

    expect(screen.getByRole("alert")).toHaveTextContent(text.errors.required);
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed email and keeps what was typed", async () => {
    const { user, email, submit } = setup();

    await user.type(email, "ana@example");
    await user.click(submit);

    expect(screen.getByRole("alert")).toHaveTextContent(text.errors.invalid);
    expect(email).toHaveValue("ana@example");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("requires the consent checkbox", async () => {
    const { user, email, submit } = setup();

    await user.type(email, "ana@example.com");
    await user.click(submit);

    expect(screen.getByRole("alert")).toHaveTextContent(text.errors.consent);
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("pretends to succeed when the honeypot is filled, without calling the action", async () => {
    const { user, view, email, consent, submit } = setup();
    const honeypot = view.container.querySelector<HTMLInputElement>('input[name="empresa-site"]');
    if (!honeypot) throw new Error("honeypot field missing");

    await user.type(email, "bot@example.com");
    await user.click(consent);
    await user.type(honeypot, "https://spam.example");
    await user.click(submit);

    expect(screen.getByRole("status")).toHaveTextContent(text.success.title);
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("shows the confirmation notice and moves focus to it on success", async () => {
    subscribeMock.mockResolvedValue({ ok: true });
    const { user, email, consent, submit } = setup();

    // An email input drops surrounding whitespace itself; the case is kept.
    await user.type(email, "  Ana@Example.com ");
    await user.click(consent);
    await user.click(submit);

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(text.success.title);
    expect(notice).toHaveTextContent("ana@example.com");
    expect(notice).toHaveFocus();
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith({ email: "Ana@Example.com", consent: true });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps the form and shows the unexpected error when the action fails", async () => {
    subscribeMock.mockResolvedValue({ ok: false });
    const { user, email, consent, submit } = setup();

    await user.type(email, "ana@example.com");
    await user.click(consent);
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(text.errors.unexpected);
    expect(screen.getByRole("textbox", { name: text.emailLabel })).toHaveValue("ana@example.com");
    expect(screen.getByRole("button", { name: text.submit })).toBeEnabled();
  });
});
