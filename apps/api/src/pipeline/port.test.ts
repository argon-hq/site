import { RequestContext } from "@mastra/core/request-context";
import { Logger } from "@nestjs/common";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindPipeline, editionContext } from "../mastra/workflows/context";
import type { PrismaService } from "../prisma/prisma.service";
import type { OwnerAlert } from "./owner-alert";
import type { PipelineService } from "./pipeline.service";
import { PipelinePortAdapter } from "./port";
import type { RetentionService } from "./retention";
import type { ScheduleRegistry } from "./schedules";
import type { EditionWatch } from "./watch";

const ok = <A>(value: A) => vi.fn(() => Effect.succeed(value));

function adapter() {
  const pipeline = { collect: ok("c"), write: ok("w"), build: ok("b"), send: ok("s") };
  const watch = { check: ok([]) };
  const retention = { run: ok("r") };
  const owners = { send: vi.fn(() => Effect.void) };
  const registry = { list: ok([]), change: ok("changed"), run: ok("fired"), reset: ok([]) };
  const port = new PipelinePortAdapter(
    pipeline as unknown as PipelineService,
    watch as unknown as EditionWatch,
    retention as unknown as RetentionService,
    owners as unknown as OwnerAlert,
    registry as unknown as ScheduleRegistry,
    {} as unknown as PrismaService,
  );
  return { port, pipeline, watch, retention, owners, registry };
}

afterEach(() => bindPipeline(undefined));

describe("the pipeline port", () => {
  it("is what a step finds while the module is up, and nothing after it stops", async () => {
    const { port } = adapter();

    port.onModuleInit();
    const bound = await Effect.runPromise(editionContext("collect", new RequestContext()));
    expect(bound.pipeline).toBe(port);

    port.onModuleDestroy();
    const exit = await Effect.runPromiseExit(editionContext("collect", new RequestContext()));
    expect(exit._tag).toBe("Failure");
  });

  it("hands each call to the service that owns it", async () => {
    const { port, pipeline, watch, retention, owners, registry } = adapter();

    await Effect.runPromise(port.collect({ mode: "mock" }));
    await Effect.runPromise(port.write({ mode: "mock" }));
    await Effect.runPromise(port.build({}));
    await Effect.runPromise(port.send({}));
    await Effect.runPromise(port.watch());
    await Effect.runPromise(port.retention());
    await Effect.runPromise(port.alert("send", "down"));
    await Effect.runPromise(port.schedules());
    await Effect.runPromise(port.changeSchedule({ id: "edition", status: "paused" }));
    await Effect.runPromise(port.runSchedule("send"));
    await Effect.runPromise(port.resetSchedules(undefined));

    expect(pipeline.collect).toHaveBeenCalledWith({ mode: "mock" });
    expect(pipeline.write).toHaveBeenCalledWith({ mode: "mock" });
    expect(pipeline.build).toHaveBeenCalled();
    expect(pipeline.send).toHaveBeenCalled();
    expect(watch.check).toHaveBeenCalled();
    expect(retention.run).toHaveBeenCalled();
    expect(owners.send).toHaveBeenCalledWith("send", "down");
    expect(registry.list).toHaveBeenCalled();
    expect(registry.change).toHaveBeenCalledWith({ id: "edition", status: "paused" });
    expect(registry.run).toHaveBeenCalledWith("send");
    expect(registry.reset).toHaveBeenCalledWith(undefined);
  });

  it("writes on Sunday the send line the daily alarm counts, with nothing sent", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    const { port } = adapter();

    await Effect.runPromise(port.heartbeat("send"));
    await Effect.runPromise(port.heartbeat("generate"));

    expect(log).toHaveBeenCalledWith(expect.objectContaining({ msg: "send finished", sunday: true, sent: 0 }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ msg: "no edition today", sunday: true }));
    log.mockRestore();
  });
});
