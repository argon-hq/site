import { describe, expect, it } from "vitest";
import { runDate, runFailure, SCHEDULE, SEND_SCHEDULE, TIMEZONE } from "./run";

describe("runDate", () => {
  it("names the run after the São Paulo calendar day", () => {
    expect(runDate(new Date("2026-09-23T08:30:00Z"))).toBe("2026-09-23"); // 5h30 in São Paulo
  });

  it("still belongs to the day that has not turned in São Paulo", () => {
    expect(runDate(new Date("2026-09-23T02:00:00Z"))).toBe("2026-09-22"); // 23h of the day before
  });
});

describe("the schedule", () => {
  it("fires at 5h30 in São Paulo, Monday to Saturday", () => {
    const [minute, hour, dayOfMonth, month, weekday] = SCHEDULE.split(" ");
    expect([minute, hour]).toEqual(["30", "5"]);
    expect([dayOfMonth, month]).toEqual(["*", "*"]);
    expect(weekday).toBe("1-6"); // 0 is Sunday, and Sunday has no edition
    expect(TIMEZONE).toBe("America/Sao_Paulo");
  });

  it("sends at 7h, an hour and a half later, so a run that repeated a step has finished", () => {
    const [minute, hour, dayOfMonth, month, weekday] = SEND_SCHEDULE.split(" ");
    expect([minute, hour]).toEqual(["0", "7"]);
    expect([dayOfMonth, month]).toEqual(["*", "*"]);
    expect(weekday).toBe("1-6"); // the same days: no edition on Sunday, nothing to send
  });
});

describe("runFailure", () => {
  it("names the step that failed and quotes its reason", () => {
    const failure = runFailure({
      status: "failed",
      steps: {
        collect: { status: "success" },
        write: { status: "failed", error: { message: "settings: boom" } },
      },
    });

    expect(failure).toEqual({ step: "write", reason: "settings: boom" });
  });

  it("falls back to the run itself when no step owns the failure", () => {
    expect(runFailure({ status: "failed", error: "the engine gave up" })).toEqual({
      step: "run",
      reason: "the engine gave up",
    });
  });

  it("says how the run ended when nothing carries a message", () => {
    expect(runFailure({ status: "suspended" })).toEqual({ step: "run", reason: "workflow ended suspended" });
  });
});
