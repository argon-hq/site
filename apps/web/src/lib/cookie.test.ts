import { afterEach, describe, expect, it, vi } from "vitest";
import { readCookie, writeCookie } from "./cookie";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Stands in for document.cookie, whose jsdom version drops Secure cookies on http. */
function stubCookie(initial: string) {
  const writes: string[] = [];
  vi.spyOn(document, "cookie", "get").mockReturnValue(initial);
  vi.spyOn(document, "cookie", "set").mockImplementation((value) => {
    writes.push(value);
  });
  return writes;
}

describe("readCookie", () => {
  it("finds a cookie among others", () => {
    stubCookie("theme=dark; locale=en-US; other=1");
    expect(readCookie("locale")).toBe("en-US");
    expect(readCookie("theme")).toBe("dark");
  });

  it("returns undefined for a missing cookie, even when another name contains it", () => {
    stubCookie("mylocale=en-US");
    expect(readCookie("locale")).toBeUndefined();
  });
});

describe("writeCookie", () => {
  it("writes a year-long, site-wide cookie the edge can read", () => {
    const writes = stubCookie("");

    writeCookie("locale", "en-US");

    expect(writes).toEqual(["locale=en-US; Path=/; Max-Age=31536000; SameSite=Lax; Secure"]);
  });
});
