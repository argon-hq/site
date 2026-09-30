import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { lookupSubscription } from "./subscription";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);
const token = "t".repeat(40);

describe("lookupSubscription", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("returns who the token belongs to, asking only with a GET", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: { email: "ana@example.com", status: "confirmed" } });

    await expect(lookupSubscription(token)).resolves.toEqual({
      kind: "found",
      subscription: { email: "ana@example.com", status: "confirmed" },
    });
    expect(apiFetchMock).toHaveBeenCalledWith(`/subscriber/unsubscribe?token=${token}`);
  });

  it("calls the link invalid only when the API says nobody holds the token", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 404 });

    await expect(lookupSubscription(token)).resolves.toEqual({ kind: "invalid" });
  });

  it.each([
    ["the API is unreachable", null],
    ["the API failed", 500],
    ["the API refused the secret", 401],
  ])("keeps the link good when %s", async (_label, status) => {
    apiFetchMock.mockResolvedValue({ ok: false, status });

    await expect(lookupSubscription(token)).resolves.toEqual({ kind: "unavailable" });
  });
});
