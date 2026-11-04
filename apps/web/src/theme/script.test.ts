import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTheme } from "./config";
import { themeScript } from "./script";

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
});

/** Runs the inline script as the browser would, with the given cookies. */
function run(cookie: string) {
  vi.spyOn(document, "cookie", "get").mockReturnValue(cookie);
  new Function(themeScript)();
  return document.documentElement.getAttribute("data-theme");
}

describe("themeScript", () => {
  it.each(["light", "dark"])("applies the saved %s theme", (theme) => {
    expect(run(`locale=en-US; theme=${theme}`)).toBe(theme);
  });

  it("removes the attribute for the system theme", () => {
    document.documentElement.setAttribute("data-theme", "light");
    expect(run("theme=system")).toBeNull();
  });

  it.each([
    ["no cookie", ""],
    ["an unknown theme", "theme=sepia"],
    ["a cookie whose name only ends in theme", "mytheme=dark"],
  ])("falls back to the default theme with %s", (_label, cookie) => {
    expect(run(cookie)).toBe(defaultTheme);
  });
});
