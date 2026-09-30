import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribe } from "@/actions/subscribe";
import { unsubscribe } from "@/actions/unsubscribe";
import { messages, renderWithIntl } from "@/test/render";
import { UnsubscribePanel } from "./unsubscribe-panel";

vi.mock("@/actions/unsubscribe", () => ({ unsubscribe: vi.fn() }));
vi.mock("@/actions/subscribe", () => ({ subscribe: vi.fn() }));

const unsubscribeMock = vi.mocked(unsubscribe);
const subscribeMock = vi.mocked(subscribe);
const text = messages.unsubscribe;
const token = "t".repeat(40);
const email = "ana@example.com";

function setup(status = "confirmed") {
  const user = userEvent.setup();
  renderWithIntl(<UnsubscribePanel token={token} email={email} status={status} />);
  return { user };
}

const heading = () => screen.getByRole("heading", { level: 1 });

describe("UnsubscribePanel", () => {
  beforeEach(() => {
    unsubscribeMock.mockReset();
    subscribeMock.mockReset();
  });

  it("asks before cancelling: opening the page cancels nothing", () => {
    setup();

    expect(heading()).toHaveTextContent(text.heading);
    expect(screen.getByText(email)).toBeInTheDocument();
    expect(unsubscribeMock).not.toHaveBeenCalled();
  });

  it("cancels on the click and offers the way back", async () => {
    unsubscribeMock.mockResolvedValue({ ok: true, status: "cancelled", email });
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: text.confirm }));

    expect(unsubscribeMock).toHaveBeenCalledWith(token);
    expect(heading()).toHaveTextContent(text.done.heading);
    expect(screen.getByRole("button", { name: text.done.reactivate })).toBeInTheDocument();
  });

  it("keeps the question on screen and explains when the cancellation fails", async () => {
    unsubscribeMock.mockResolvedValue({ ok: false });
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: text.confirm }));

    expect(screen.getByRole("alert")).toHaveTextContent(text.error);
    expect(screen.getByRole("button", { name: text.confirm })).toBeEnabled();
  });

  it("says the address was already off the list when the click finds it cancelled", async () => {
    unsubscribeMock.mockResolvedValue({ ok: true, status: "already_cancelled", email });
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: text.confirm }));

    expect(screen.getByText(/já estava fora da lista/)).toBeInTheDocument();
  });

  it("opens on the cancelled state for a subscription already cancelled, with the way back", () => {
    setup("cancelled");

    expect(heading()).toHaveTextContent(text.done.heading);
    expect(screen.getByText(/já estava fora da lista/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: text.done.reactivate })).toBeInTheDocument();
  });

  it("asks for a new consent before reactivating", async () => {
    const { user } = setup("cancelled");

    await user.click(screen.getByRole("button", { name: text.done.reactivate }));

    expect(screen.getByRole("alert")).toHaveTextContent(text.done.consentError);
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("reactivates as a new sign-up and says the confirmation is on its way", async () => {
    subscribeMock.mockResolvedValue({ ok: true });
    const { user } = setup("cancelled");

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: text.done.reactivate }));

    expect(subscribeMock).toHaveBeenCalledWith({ email, consent: true });
    expect(heading()).toHaveTextContent(text.reactivated.heading);
  });

  it("keeps the way back and explains when the reactivation fails", async () => {
    subscribeMock.mockResolvedValue({ ok: false });
    const { user } = setup("cancelled");

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: text.done.reactivate }));

    expect(screen.getByRole("alert")).toHaveTextContent(text.done.error);
    expect(screen.getByRole("button", { name: text.done.reactivate })).toBeEnabled();
  });

  // The sign-up ignores these addresses: offering the way back would promise an e-mail that never leaves.
  it.each(["bounced", "blocked"])("does not offer a %s address a way back the sign-up would ignore", (status) => {
    setup(status);

    expect(heading()).toHaveTextContent(text.done.heading);
    expect(screen.queryByRole("button", { name: text.done.reactivate })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /outro e-mail/ })).toHaveAttribute("href", "/newsletter");
  });
});
