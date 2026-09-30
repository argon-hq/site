import { describe, expect, it } from "vitest";
import { parseFeedDate } from "./dates";

const iso = (raw: string) => parseFeedDate(raw)?.toISOString();

describe("parseFeedDate", () => {
  it("reads RFC 822 with and without the weekday, and -0000 as UTC", () => {
    expect(iso("Tue, 29 Sep 2026 19:32:00 -0300")).toBe("2026-09-29T22:32:00.000Z");
    expect(iso("29 Sep 2026 22:30:00 -0300")).toBe("2026-09-30T01:30:00.000Z");
    expect(iso("Wed, 30 Sep 2026 01:15:30 -0000")).toBe("2026-09-30T01:15:30.000Z");
    expect(iso("Tue, 29 Sep 2026 21:51:41 +0000")).toBe("2026-09-29T21:51:41.000Z");
    expect(iso("Tue, 29 Sep 2026 21:51:41 GMT")).toBe("2026-09-29T21:51:41.000Z");
  });

  it("reads ISO with an offset, and Valor's microseconds", () => {
    expect(iso("2026-09-30T01:19:44+00:00")).toBe("2026-09-30T01:19:44.000Z");
    expect(iso("2026-09-30T01:15:30.195000+00:00")).toBe("2026-09-30T01:15:30.195Z");
    expect(iso("2026-09-29T22:00:00Z")).toBe("2026-09-29T22:00:00.000Z");
    expect(iso("2026-09-29T19:00:00-0300")).toBe("2026-09-29T22:00:00.000Z");
  });

  it("reads a date without an offset as São Paulo time, as Exame writes it", () => {
    expect(iso("2026-09-29T18:29:35")).toBe("2026-09-29T21:29:35.000Z");
    expect(iso("29 Sep 2026 18:29:35")).toBe("2026-09-29T21:29:35.000Z");
    expect(iso("2026-09-29")).toBe("2026-09-29T03:00:00.000Z");
  });

  it("gives nothing for a missing or unreadable date", () => {
    expect(parseFeedDate(undefined)).toBeNull();
    expect(parseFeedDate("")).toBeNull();
    expect(parseFeedDate("ontem à tarde")).toBeNull();
  });
});
