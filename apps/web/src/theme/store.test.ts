import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTheme } from "./config";
import { readTheme, saveTheme, subscribeTheme } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
});

function stubCookie(initial: string) {
  const writes: string[] = [];
  vi.spyOn(document, "cookie", "get").mockReturnValue(initial);
  vi.spyOn(document, "cookie", "set").mockImplementation((value) => {
    writes.push(value);
  });
  return writes;
}

describe("readTheme", () => {
  it("reads the saved theme", () => {
    stubCookie("theme=dark");
    expect(readTheme()).toBe("dark");
  });

  it.each(["", "theme=sepia"])("falls back to the default theme for %j", (cookie) => {
    stubCookie(cookie);
    expect(readTheme()).toBe(defaultTheme);
  });
});

describe("saveTheme", () => {
  it("writes the cookie, applies the attribute and notifies the subscribers", () => {
    const writes = stubCookie("");
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);

    saveTheme("dark");

    expect(writes[0]).toMatch(/^theme=dark; Path=\/;/);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    saveTheme("light");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("removes the attribute for the system theme", () => {
    stubCookie("");
    document.documentElement.setAttribute("data-theme", "dark");

    saveTheme("system");

    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});
