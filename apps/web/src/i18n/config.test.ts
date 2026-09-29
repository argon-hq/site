import { describe, expect, it } from "vitest";
import { defaultLocale, isLocale, locales } from "./config";

describe("isLocale", () => {
  it("accepts every configured locale", () => {
    for (const locale of locales) expect(isLocale(locale)).toBe(true);
  });

  it("accepts the default locale", () => {
    expect(isLocale(defaultLocale)).toBe(true);
  });

  it.each(["fr-FR", "pt", "", undefined, null, 1, {}])("rejects %j", (value) => {
    expect(isLocale(value)).toBe(false);
  });
});
