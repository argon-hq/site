import { RequestContext } from "@mastra/core/request-context";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { SendReport } from "../../pipeline/pipeline.service";
import type { EditionContext, PipelinePort } from "./context";
import { sendWorkflow } from "./send";

const report: SendReport = {
  date: "2026-11-04",
  editionId: "e1",
  status: "sent",
  recipients: 2,
  created: 2,
  alreadySent: 0,
  batches: [{ batch: 1, size: 2, sent: 2, failed: 0 }],
  sent: 2,
  failed: 0,
  durationMs: 12,
};

type Step = { execute: (args: unknown) => Promise<SendReport>; retries?: number };

const run = (send: PipelinePort["send"], inputData: unknown) => {
  const requestContext = new RequestContext<EditionContext>();
  requestContext.set("pipeline", { send, alert: () => Effect.void } as unknown as PipelinePort);
  return (sendWorkflow.steps.send as unknown as Step).execute({ inputData, requestContext, runId: "run-1" });
};

describe("the send workflow", () => {
  it("sends today's edition and hands back the report per batch", async () => {
    const send = vi.fn(() => Effect.succeed(report));

    await expect(run(send, {})).resolves.toEqual(report);
    expect(send).toHaveBeenCalledWith({ date: undefined, runId: "run-1" });
  });

  it("names the day for a resume", async () => {
    const send = vi.fn(() => Effect.succeed(report));

    await run(send, { date: "2026-11-03" });

    expect(send).toHaveBeenCalledWith({ date: new Date("2026-11-03T00:00:00Z"), runId: "run-1" });
  });

  it("does not try again: running the send again is how it resumes", () => {
    expect((sendWorkflow.steps.send as unknown as Step).retries).toBe(0);
  });
});
