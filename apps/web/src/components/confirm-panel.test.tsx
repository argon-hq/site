import { screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirm } from "@/actions/confirm";
import { messages, renderWithIntl } from "@/test/render";
import { ConfirmPanel } from "./confirm-panel";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/actions/confirm", () => ({ confirm: vi.fn() }));

const confirmMock = vi.mocked(confirm);
const text = messages.confirm;
const token = "a".repeat(32);

describe("ConfirmPanel", () => {
  beforeEach(() => {
    confirmMock.mockReset();
    replace.mockReset();
  });

  it("shows the invalid state without a token and never calls the action", () => {
    renderWithIntl(<ConfirmPanel token={null} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(text.invalid.heading);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("calls confirm exactly once, even with the effect running twice", async () => {
    confirmMock.mockReturnValue(new Promise(() => {}));

    renderWithIntl(
      <StrictMode>
        <ConfirmPanel token={token} />
      </StrictMode>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(text.confirming.heading);
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock).toHaveBeenCalledWith(token);
  });

  it.each([
    ["expired", text.expired.heading],
    ["invalid", text.invalid.heading],
    ["error", text.error.heading],
  ] as const)("maps the %s reason to its heading", async (reason, heading) => {
    confirmMock.mockResolvedValue({ ok: false, reason });

    renderWithIntl(<ConfirmPanel token={token} />);

    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/newsletter");
    expect(replace).not.toHaveBeenCalled();
  });

  it("goes to the confirmed page on success", async () => {
    confirmMock.mockResolvedValue({ ok: true, status: "confirmed" });

    renderWithIntl(<ConfirmPanel token={token} />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/newsletter/confirmed"));
  });
});
