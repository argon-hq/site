import type { MastraService } from "@mastra/nestjs";
import { Logger } from "@nestjs/common";
import { Duration, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MastraClock } from "./clock";
import type { ScheduleRegistry } from "./schedules";

afterEach(() => vi.restoreAllMocks());

function clock(startWorkers: () => Promise<void>) {
  vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
  const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
  const mastra = {
    pubsub: { subscribe: vi.fn(async () => {}), unsubscribe: vi.fn(async () => {}) },
    startWorkers: vi.fn(startWorkers),
    stopWorkers: vi.fn(async () => {}),
  };
  const registry = { running: false, sync: vi.fn(() => Effect.void) };
  const subject = new MastraClock(
    { getMastra: () => mastra } as unknown as MastraService,
    registry as unknown as ScheduleRegistry,
  );
  subject.retryAfter = Duration.millis(5);
  return { subject, mastra, registry, errors };
}

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("the clock", () => {
  it("does not take the API down when the database is not there at boot, and starts once it is", async () => {
    let attempts = 0;
    const { subject, mastra, registry, errors } = clock(async () => {
      attempts++;
      if (attempts < 3) throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    });

    await expect(subject.onApplicationBootstrap()).resolves.toBeUndefined();
    await until(() => registry.running);

    expect(mastra.startWorkers).toHaveBeenCalledTimes(3);
    expect(registry.sync).toHaveBeenCalledTimes(3);
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ msg: "clock start failed" }));
    expect(registry.running).toBe(true);

    await subject.beforeApplicationShutdown();
    expect(mastra.stopWorkers).toHaveBeenCalledOnce();
  });

  it("stops trying on shutdown, and has no workers to stop", async () => {
    const { subject, mastra, registry } = clock(async () => {
      throw new Error("down");
    });

    await subject.onApplicationBootstrap();
    await subject.beforeApplicationShutdown();
    const tried = mastra.startWorkers.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(mastra.startWorkers.mock.calls.length).toBe(tried);
    expect(mastra.stopWorkers).not.toHaveBeenCalled();
    expect(registry.running).toBe(false);
  });
});
