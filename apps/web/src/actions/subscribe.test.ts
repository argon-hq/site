import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { subscribe } from "./subscribe";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "test-agent" }),
}));

const apiFetchMock = vi.mocked(apiFetch);

describe("subscribe", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it.each([
    ["an empty email", { email: "", consent: true }],
    ["a malformed email", { email: "ana@example", consent: true }],
    ["an email over 254 characters", { email: `${"a".repeat(250)}@example.com`, consent: true }],
    ["consent not given", { email: "ana@example.com", consent: false }],
  ])("refuses %s without calling the API", async (_label, input) => {
    await expect(subscribe(input)).resolves.toEqual({ ok: false });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("sends the normalized email with the opt-in proof", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: { status: "pending" } });

    await expect(subscribe({ email: "  Ana@Example.COM ", consent: true })).resolves.toEqual({
      ok: true,
    });

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith("/subscriber", {
      method: "POST",
      body: {
        email: "ana@example.com",
        consentIp: "203.0.113.7",
        consentUserAgent: "test-agent",
      },
    });
  });

  it("reports failure when the API fails", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(subscribe({ email: "ana@example.com", consent: true })).resolves.toEqual({
      ok: false,
    });
  });
});
