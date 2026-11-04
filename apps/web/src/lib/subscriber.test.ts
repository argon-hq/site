import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { confirm, lookupSubscription, subscribe, unsubscribe } from "./subscriber";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);
const token = "t".repeat(40);

const malformedTokens = [
  ["5 characters", "abcde"],
  ["19 characters", "a".repeat(19)],
  ["101 characters", "a".repeat(101)],
  ["empty", ""],
] as const;

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("subscribe", () => {
  it.each([
    ["an empty email", { email: "", consent: true }],
    ["a malformed email", { email: "ana@example", consent: true }],
    ["an email over 254 characters", { email: `${"a".repeat(250)}@example.com`, consent: true }],
    ["consent not given", { email: "ana@example.com", consent: false }],
  ])("refuses %s without calling the API", async (_label, input) => {
    await expect(subscribe(input)).resolves.toEqual({ ok: false });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("sends only the normalized email: the API takes the opt-in proof from the request", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: { status: "pending" } });

    await expect(subscribe({ email: "  Ana@Example.COM ", consent: true })).resolves.toEqual({
      ok: true,
    });

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith("/subscriber", {
      method: "POST",
      body: { email: "ana@example.com" },
    });
  });

  it("reports failure when the API fails", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(subscribe({ email: "ana@example.com", consent: true })).resolves.toEqual({
      ok: false,
    });
  });
});

describe("confirm", () => {
  it.each(malformedTokens)("treats a token of %s as invalid without calling the API", async (_label, value) => {
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

describe("lookupSubscription", () => {
  it.each(malformedTokens)("returns null for a token of %s without calling the API", async (_label, value) => {
    await expect(lookupSubscription(value)).resolves.toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("reads the owner of the token with a GET", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: { email: "ana@example.com", status: "confirmed" } });

    await expect(lookupSubscription(token)).resolves.toEqual({ email: "ana@example.com", status: "confirmed" });
    expect(apiFetchMock).toHaveBeenCalledWith(`/subscriber/unsubscribe?token=${token}`);
  });

  it.each([
    ["an unknown token", { ok: false, status: 404 }],
    ["an unreachable API", { ok: false, status: null }],
  ] as const)("returns null for %s", async (_label, response) => {
    apiFetchMock.mockResolvedValue(response);

    await expect(lookupSubscription(token)).resolves.toBeNull();
  });
});

describe("unsubscribe", () => {
  it.each(malformedTokens)("refuses a token of %s without calling the API", async (_label, value) => {
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
