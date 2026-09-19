import { describe, expect, it } from "vitest";
import { flatten } from "./logger";

describe("flatten", () => {
  it("turns our log objects into one readable line", () => {
    expect(flatten({ msg: "sign-up pending", subscriberId: "abc", returning: true })).toBe(
      "sign-up pending subscriberId=abc returning=true",
    );
  });

  it("quotes a value with spaces, so the pairs stay readable", () => {
    expect(flatten({ msg: "confirmation not sent", error: "Error: provider down" })).toBe(
      'confirmation not sent error="Error: provider down"',
    );
  });

  it("keeps dates and nested values legible", () => {
    const line = flatten({ msg: "sent", at: new Date("2026-09-19T00:00:00Z"), usage: { input: 10 } });
    expect(line).toBe('sent at=2026-09-19T00:00:00.000Z usage={"input":10}');
  });

  it("leaves alone what it did not produce", () => {
    // Nest logs its own strings, and a stray object is better printed whole than mangled.
    expect(flatten("Nest application successfully started")).toBe("Nest application successfully started");
    const stray = { id: 1 };
    expect(flatten(stray)).toBe(stray);
  });
});
