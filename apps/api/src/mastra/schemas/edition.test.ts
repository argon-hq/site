import { describe, expect, it } from "vitest";
import { writtenItemSchema } from "./edition";

describe("writtenItemSchema", () => {
  it("strips zero-width characters before checking the length", () => {
    const body = "x".repeat(190) + "​";
    expect(writtenItemSchema.parse({ category: "economy", headline: "h", body }).body).toHaveLength(190);
  });

  it("turns line breaks and other control characters into one space", () => {
    const parsed = writtenItemSchema.parse({ category: "economy", headline: "Copom\r\nmantém\ta Selic", body: "b" });
    expect(parsed.headline).toBe("Copom mantém a Selic");
  });

  it("rejects a body over the limit", () => {
    expect(() => writtenItemSchema.parse({ category: "economy", headline: "h", body: "x".repeat(191) })).toThrow();
  });
});
