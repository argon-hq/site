import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupSubscription } from "@/lib/subscriber";
import { messages, renderWithIntl } from "@/test/render";
import { UnsubscribeFromLink } from "./unsubscribe-panel";

const { searchParams } = vi.hoisted(() => ({ searchParams: { current: new URLSearchParams() } }));

vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams.current }));
vi.mock("@/lib/subscriber", () => ({ lookupSubscription: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));

const lookupMock = vi.mocked(lookupSubscription);
const text = messages.unsubscribe;
const token = "a".repeat(32);

function withToken(value: string) {
  searchParams.current = new URLSearchParams({ token: value });
}

describe("UnsubscribeFromLink", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    searchParams.current = new URLSearchParams();
  });

  it.each([
    ["no token", null],
    ["a malformed token", "abc"],
  ])("shows the invalid link for %s without calling the API", (_label, value) => {
    if (value) withToken(value);

    renderWithIntl(<UnsubscribeFromLink />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(text.invalid.heading);
    expect(screen.getByRole("link", { name: text.invalid.cta })).toHaveAttribute("href", "/");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("shows the checking state while the API answers", () => {
    withToken(token);
    lookupMock.mockReturnValue(new Promise(() => {}));

    renderWithIntl(<UnsubscribeFromLink />);

    expect(screen.getByRole("status")).toHaveTextContent(text.checking.heading);
    expect(lookupMock).toHaveBeenCalledWith(token);
  });

  it("asks for confirmation once it knows whose subscription it is", async () => {
    withToken(token);
    lookupMock.mockResolvedValue({ email: "ana@example.com", status: "confirmed" });

    renderWithIntl(<UnsubscribeFromLink />);

    expect(await screen.findByRole("heading", { level: 1, name: text.heading })).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: text.confirm })).toBeEnabled();
  });

  it("goes straight to the cancelled state for a subscription already out", async () => {
    withToken(token);
    lookupMock.mockResolvedValue({ email: "ana@example.com", status: "cancelled" });

    renderWithIntl(<UnsubscribeFromLink />);

    expect(await screen.findByRole("heading", { level: 1, name: text.done.heading })).toBeInTheDocument();
  });

  it("shows the invalid link when the API does not know the token", async () => {
    withToken(token);
    lookupMock.mockResolvedValue(null);

    renderWithIntl(<UnsubscribeFromLink />);

    expect(await screen.findByRole("heading", { level: 1, name: text.invalid.heading })).toBeInTheDocument();
  });
});
