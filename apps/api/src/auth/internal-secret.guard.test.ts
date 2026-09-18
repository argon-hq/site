import { describe, expect, it } from "vitest";
import { safeEqual } from "./internal-secret.guard";

describe("safeEqual", () => {
  it("matches identical secrets and rejects different ones", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "")).toBe(false);
  });
});
