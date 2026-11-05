import { RequestContext } from "@mastra/core/request-context";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindPipeline, editionContext } from "../mastra/workflows/context";
import type { PrismaService } from "../prisma/prisma.service";
import type { OwnerAlert } from "./owner-alert";
import type { PipelineService } from "./pipeline.service";
import { PipelinePortAdapter } from "./port";
import type { WriteDataset } from "./write-dataset";

const ok = <A>(value: A) => vi.fn(() => Effect.succeed(value));

function adapter() {
  const pipeline = { ingest: ok("i"), write: ok("w"), build: ok("b"), send: ok("s") };
  const owners = { send: vi.fn(() => Effect.void) };
  const dataset = { addDay: ok("added") };
  const port = new PipelinePortAdapter(
    pipeline as unknown as PipelineService,
    owners as unknown as OwnerAlert,
    {} as unknown as PrismaService,
    dataset as unknown as WriteDataset,
  );
  return { port, pipeline, owners, dataset };
}

afterEach(() => bindPipeline(undefined));

describe("the pipeline port", () => {
  it("is what a step finds while the module is up, and nothing after it stops", async () => {
    const { port } = adapter();

    port.onModuleInit();
    const bound = await Effect.runPromise(editionContext("ingest", new RequestContext()));
    expect(bound.pipeline).toBe(port);

    port.onModuleDestroy();
    const exit = await Effect.runPromiseExit(editionContext("ingest", new RequestContext()));
    expect(exit._tag).toBe("Failure");
  });

  it("hands each call to the service that owns it", async () => {
    const { port, pipeline, owners, dataset } = adapter();

    await Effect.runPromise(port.ingest({ mode: "mock" }));
    await Effect.runPromise(port.write({ mode: "mock" }));
    await Effect.runPromise(port.build({}));
    await Effect.runPromise(port.send({}));
    await Effect.runPromise(port.alert("send", "down"));
    await Effect.runPromise(port.addToWriteDataset("2026-11-04"));

    expect(pipeline.ingest).toHaveBeenCalledWith({ mode: "mock" });
    expect(pipeline.write).toHaveBeenCalledWith({ mode: "mock" });
    expect(pipeline.build).toHaveBeenCalled();
    expect(pipeline.send).toHaveBeenCalled();
    expect(owners.send).toHaveBeenCalledWith("send", "down");
    expect(dataset.addDay).toHaveBeenCalledWith("2026-11-04");
  });
});
