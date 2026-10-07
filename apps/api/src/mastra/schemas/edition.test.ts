import { describe, expect, it } from "vitest";
import { BODY_MAX, writtenItemSchema } from "./edition";

describe("writtenItemSchema", () => {
  it("strips zero-width characters before checking the length", () => {
    const body = "x".repeat(BODY_MAX) + "​";
    expect(writtenItemSchema.parse({ category: "economy", headline: "h", body }).body).toHaveLength(BODY_MAX);
  });

  it("turns line breaks and other control characters into one space", () => {
    const parsed = writtenItemSchema.parse({ category: "economy", headline: "Copom\r\nmantém\ta Selic", body: "b" });
    expect(parsed.headline).toBe("Copom mantém a Selic");
  });

  it("rejects a body over the limit", () => {
    expect(() =>
      writtenItemSchema.parse({ category: "economy", headline: "h", body: "x".repeat(BODY_MAX + 1) }),
    ).toThrow();
  });
});
