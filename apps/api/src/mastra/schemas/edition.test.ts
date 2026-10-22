import { describe, expect, it } from "vitest";
import { BODY_MAX, BODY_MIN, writtenItemSchema } from "./edition";

const body = "x".repeat(BODY_MIN);

describe("writtenItemSchema", () => {
  it("strips zero-width characters before checking the length", () => {
    const long = "x".repeat(BODY_MAX) + "​";
    expect(writtenItemSchema.parse({ category: "economy", headline: "h", body: long }).body).toHaveLength(BODY_MAX);
  });

  it("turns line breaks and other control characters into one space", () => {
    const parsed = writtenItemSchema.parse({ category: "economy", headline: "Copom\r\nmantém\ta Selic", body });
    expect(parsed.headline).toBe("Copom mantém a Selic");
  });

  it("rejects a body over the limit", () => {
    expect(() =>
      writtenItemSchema.parse({ category: "economy", headline: "h", body: "x".repeat(BODY_MAX + 1) }),
    ).toThrow();
  });

  it("rejects a body under the minimum, counted after cleaning", () => {
    expect(writtenItemSchema.safeParse({ category: "economy", headline: "h", body }).success).toBe(true);
    const padded = "  " + "x".repeat(BODY_MIN - 1) + "\u200b  ";
    expect(writtenItemSchema.safeParse({ category: "economy", headline: "h", body: padded }).success).toBe(false);
  });
});
