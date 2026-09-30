import { describe, expect, it } from "vitest";
import { editionDate, windowHours, windowStart } from "./rules";

describe("edition rules", () => {
  it("opens a 48h window on Mondays, 24h otherwise", () => {
    expect(windowHours(new Date("2026-09-21T12:00:00-03:00"))).toBe(48); // Monday
    expect(windowHours(new Date("2026-09-22T12:00:00-03:00"))).toBe(24);
    expect(windowHours(new Date("2026-09-21T01:00:00Z"))).toBe(24); // still Sunday in São Paulo
  });

  it("starts the window that many hours before the clock", () => {
    const monday = new Date("2026-09-21T08:30:00Z");
    expect(windowStart(monday).toISOString()).toBe("2026-09-19T08:30:00.000Z");
  });

  it("dates the edition by the São Paulo calendar day", () => {
    expect(editionDate(new Date("2026-09-22T08:30:00Z")).toISOString()).toBe("2026-09-22T00:00:00.000Z");
    // 21:00 in São Paulo, already the 23rd in UTC: the edition is still the 22nd.
    expect(editionDate(new Date("2026-09-23T00:00:00Z")).toISOString()).toBe("2026-09-22T00:00:00.000Z");
  });
});
