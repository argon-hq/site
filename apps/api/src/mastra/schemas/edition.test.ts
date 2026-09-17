import { describe, expect, it } from "vitest";
import { writtenItemSchema } from "./edition";

describe("writtenItemSchema", () => {
  it("strips zero-width characters before checking the length", () => {
    const body = "x".repeat(190) + "​";
    expect(writtenItemSchema.parse({ category: "economy", headline: "h", body }).body).toHaveLength(190);
  });

  it("rejects a body over the limit", () => {
    expect(() => writtenItemSchema.parse({ category: "economy", headline: "h", body: "x".repeat(191) })).toThrow();
  });
});
