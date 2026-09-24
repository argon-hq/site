import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { unsubscribe } from "./unsubscribe";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);
const token = "t".repeat(40);

describe("unsubscribe", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it.each([
    ["5 characters", "abcde"],
    ["19 characters", "a".repeat(19)],
    ["101 characters", "a".repeat(101)],
  ])("refuses a token of %s without calling the API", async (_label, value) => {
    await expect(unsubscribe(value)).resolves.toEqual({ ok: false });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("posts a well-formed token and returns the cancelled status", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      data: { status: "cancelled", email: "ana@example.com" },
    });

    await expect(unsubscribe(token)).resolves.toEqual({
      ok: true,
      status: "cancelled",
      email: "ana@example.com",
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/subscriber/unsubscribe", {
      method: "POST",
      body: { token },
    });
  });

  it("keeps the already_cancelled status", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      data: { status: "already_cancelled", email: "ana@example.com" },
    });

    await expect(unsubscribe(token)).resolves.toMatchObject({ status: "already_cancelled" });
  });

  it.each([
    ["invalid status", { ok: true, data: { status: "invalid", email: "ana@example.com" } }],
    ["missing email", { ok: true, data: { status: "cancelled" } }],
    ["API failure", { ok: false, status: 502 }],
  ] as const)("reports failure on %s", async (_label, response) => {
    apiFetchMock.mockResolvedValue(response);

    await expect(unsubscribe(token)).resolves.toEqual({ ok: false });
  });
});
