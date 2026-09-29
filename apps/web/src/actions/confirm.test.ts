import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { confirm } from "./confirm";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);
const token = "t".repeat(40);

describe("confirm", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it.each([
    ["5 characters", "abcde"],
    ["19 characters", "a".repeat(19)],
    ["101 characters", "a".repeat(101)],
    ["empty", ""],
  ])("treats a token of %s as invalid without calling the API", async (_label, value) => {
    await expect(confirm(value)).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("posts a well-formed token", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: { status: "confirmed" } });

    await expect(confirm(token)).resolves.toEqual({ ok: true, status: "confirmed" });
    expect(apiFetchMock).toHaveBeenCalledWith("/subscriber/confirm", {
      method: "POST",
      body: { token },
    });
  });

  it.each([
    ["already_confirmed", { ok: true, status: "already_confirmed" }],
    ["expired", { ok: false, reason: "expired" }],
    ["invalid", { ok: false, reason: "invalid" }],
    ["something-else", { ok: false, reason: "invalid" }],
  ])("maps the API status %s", async (status, expected) => {
    apiFetchMock.mockResolvedValue({ ok: true, data: { status } });

    await expect(confirm(token)).resolves.toEqual(expected);
  });

  it("reports an error when the API fails", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: null });

    await expect(confirm(token)).resolves.toEqual({ ok: false, reason: "error" });
  });
});
