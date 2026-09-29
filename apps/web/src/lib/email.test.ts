import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ana.Silva@Example.COM  ")).toBe("ana.silva@example.com");
  });
});

describe("isValidEmail", () => {
  it.each(["ana@example.com", "  ANA@EXAMPLE.COM ", "a.b+c@sub.domain.co"])("accepts %j", (value) => {
    expect(isValidEmail(value)).toBe(true);
  });

  it.each(["", "ana", "ana@", "@example.com", "ana@example", "ana@example.c", "a na@example.com"])(
    "rejects %j",
    (value) => {
      expect(isValidEmail(value)).toBe(false);
    },
  );
});
