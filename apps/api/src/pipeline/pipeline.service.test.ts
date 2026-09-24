import type { MastraService } from "@mastra/nestjs";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import type { SettingsService } from "../settings/settings.service";
import type { DeliveryService } from "./delivery.service";
import { EditionLock } from "./lock";
import type { OwnerAlert } from "./owner-alert";
import { PipelineService } from "./pipeline.service";

const origins = { web: "https://argon.example", api: "https://api.argon.example" };

// A lock that always grants, recording what it was asked to hold; the real one is tested on its own.
function grantingLock() {
  const held: string[] = [];
  const lock = new EditionLock("postgresql://x", () => ({
    connect: async () => {},
    query: async (text: string) => {
      if (text.includes("try_advisory_lock")) held.push("lock");
      if (text.includes("advisory_unlock")) held.push("unlock");
      return { rows: [{ locked: true }] };
    },
    end: async () => {},
  }));
  return { lock, held };
}

// A run of the Mastra workflow that answers what it is told to, after a tick, so two calls can overlap.
function workflow(result: {
  status: string;
  result?: unknown;
  steps?: Record<string, { status: string; error?: unknown }>;
}) {
  const start = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return result;
  });
  const createRun = vi.fn(async () => ({ runId: "run-1", start }));
  const mastra = { getWorkflow: vi.fn(() => ({ createRun })), getAgent: vi.fn() };
  return { mastra, start };
}

function service(p: { mastra?: unknown; delivery?: { send?: unknown } } = {}) {
  const { lock, held } = grantingLock();
  const delivery = { send: vi.fn(() => Effect.succeed({ status: "sent" })), ...p.delivery };
  const alert = { send: vi.fn(() => Effect.void), onFailure: vi.fn((_, e) => e) };
  const pipeline = new PipelineService(
    (p.mastra ?? { getWorkflow: vi.fn(), getAgent: vi.fn() }) as unknown as MastraService,
    {} as unknown as PrismaService,
    {} as unknown as SettingsService,
    alert as unknown as OwnerAlert,
    origins,
    lock,
    delivery as unknown as DeliveryService,
  );
  return { pipeline, delivery, alert, held };
}

const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && exit.cause._tag === "Fail"
    ? (exit.cause.error as { reason: string; status?: number; step?: string })
    : null;

describe("PipelineService.run", () => {
  it("refuses a second run while one is in flight, with a conflict, and lets the next one through after", async () => {
    const { mastra, start } = workflow({ status: "success", result: { date: "2026-09-24", mode: "mock" } });
    const { pipeline, alert } = service({ mastra });

    const [first, second] = await Promise.all([
      Effect.runPromiseExit(pipeline.run({ mode: "mock" })),
      Effect.runPromiseExit(pipeline.run({ mode: "mock" })),
    ]);

    expect(Exit.isSuccess(first)).toBe(true);
    expect(failureOf(second)).toMatchObject({ step: "run", status: 409, reason: expect.stringContaining("in flight") });
    expect(start).toHaveBeenCalledTimes(1);
    // A refused call is not a failed run: nothing broke, so nobody is alerted.
    expect(alert.send).not.toHaveBeenCalled();

    // The gate opens again once the first run is over.
    expect(Exit.isSuccess(await Effect.runPromiseExit(pipeline.run({ mode: "mock" })))).toBe(true);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("opens the gate again after a failed run, and alerts once for the step that failed", async () => {
    const { mastra, start } = workflow({
      status: "failed",
      steps: { collect: { status: "success" }, write: { status: "failed", error: new Error("no news") } },
    });
    const { pipeline, alert } = service({ mastra });

    const exit = await Effect.runPromiseExit(pipeline.run({ mode: "mock" }));

    expect(failureOf(exit)).toMatchObject({ step: "write", reason: "no news" });
    expect(alert.send).toHaveBeenCalledWith("write", "no news");
    // The gate is open again: the next call reaches the workflow.
    await Effect.runPromiseExit(pipeline.run({ mode: "mock" }));
    expect(start).toHaveBeenCalledTimes(2);
  });
});

describe("PipelineService.send", () => {
  it("hands the send to the delivery service under the edition's lock, for today by default", async () => {
    const { pipeline, delivery, held } = service();
    const now = new Date("2026-09-24T10:00:00Z");

    await Effect.runPromise(pipeline.send({ now }));

    expect(delivery.send).toHaveBeenCalledWith(new Date("2026-09-24T00:00:00Z"), now);
    expect(held).toEqual(["lock", "unlock"]);
  });

  it("sends the day it is given, so a stuck edition can be resumed after midnight", async () => {
    const { pipeline, delivery } = service();
    const date = new Date("2026-09-20T00:00:00Z");

    await Effect.runPromise(pipeline.send({ date, now: new Date("2026-09-24T10:00:00Z") }));

    expect(delivery.send).toHaveBeenCalledWith(date, expect.any(Date));
  });

  it("refuses a second send while one is in flight, and opens the gate after", async () => {
    let release: () => void = () => {};
    const done = new Promise<{ status: "sent" }>((resolve) => (release = () => resolve({ status: "sent" })));
    const slow = Effect.promise(() => done);
    const { pipeline, delivery } = service({ delivery: { send: vi.fn(() => slow) } });

    const first = Effect.runPromiseExit(pipeline.send());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await Effect.runPromiseExit(pipeline.send());
    release();
    await first;

    expect(failureOf(second)).toMatchObject({ status: 409, reason: expect.stringContaining("in flight") });
    expect(delivery.send).toHaveBeenCalledTimes(1);
    expect(Exit.isSuccess(await Effect.runPromiseExit(pipeline.send()))).toBe(true);
  });

  it("keeps the failure the delivery reports, status included", async () => {
    const { pipeline } = service({
      delivery: {
        send: vi.fn(() =>
          Effect.fail({ _tag: "SendFailed", reason: "edition 2026-09-24 does not exist yet", status: 404 }),
        ),
      },
    });

    const exit = await Effect.runPromiseExit(pipeline.send());

    expect(failureOf(exit)).toMatchObject({ status: 404 });
  });
});
