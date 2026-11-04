import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiOrigin } from "./api";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  // The failures log on purpose; the tests only care about the result.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("apiOrigin", () => {
  it("uses the origin inlined at build time", () => {
    vi.stubEnv("NEXT_PUBLIC_API_ORIGIN", "https://api.lab.argonbusiness.com");
    expect(apiOrigin()).toBe("https://api.lab.argonbusiness.com");
  });

  it("falls back to the local API", () => {
    vi.stubEnv("NEXT_PUBLIC_API_ORIGIN", "");
    expect(apiOrigin()).toBe("http://localhost:3001");
  });
});

describe("apiFetch", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_ORIGIN", "https://api.example.com");
  });

  it("posts JSON without credentials or any secret", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "pending" }));

    await expect(apiFetch("/subscriber", { method: "POST", body: { email: "ana@example.com" } })).resolves.toEqual({
      ok: true,
      data: { status: "pending" },
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/subscriber", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ana@example.com" }),
      credentials: "omit",
      cache: "no-store",
    });
  });

  it("sends a GET without headers, so the browser skips the CORS preflight", async () => {
    fetchMock.mockResolvedValue(Response.json({ email: "ana@example.com", status: "confirmed" }));

    await apiFetch("/subscriber/unsubscribe?token=abc");

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/subscriber/unsubscribe?token=abc", {
      method: "GET",
      headers: undefined,
      body: undefined,
      credentials: "omit",
      cache: "no-store",
    });
  });

  it("returns the status of an error response", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(apiFetch("/subscriber/unsubscribe?token=abc")).resolves.toEqual({ ok: false, status: 404 });
  });

  it("turns a network failure into a result, never an exception", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(apiFetch("/subscriber", { method: "POST", body: {} })).resolves.toEqual({ ok: false, status: null });
  });
});
