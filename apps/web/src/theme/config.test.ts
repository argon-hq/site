import { describe, expect, it } from "vitest";
import { defaultTheme, isTheme, themes } from "./config";

describe("isTheme", () => {
  it("accepts every configured theme", () => {
    for (const theme of themes) expect(isTheme(theme)).toBe(true);
  });

  it("accepts the default theme", () => {
    expect(isTheme(defaultTheme)).toBe(true);
  });

  it.each(["sepia", "", undefined, null, 0, []])("rejects %j", (value) => {
    expect(isTheme(value)).toBe(false);
  });
});
