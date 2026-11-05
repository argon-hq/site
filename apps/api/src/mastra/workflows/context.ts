import type { RequestContext } from "@mastra/core/request-context";
import { Data, Effect } from "effect";
import type { DeliveryStatus } from "../../pipeline/delivery-status";
import type { EditionHtml } from "../../pipeline/edition-html";
import type {
  BuildReport,
  IngestReport,
  SendReport,
  SendRun,
  StepRun,
  WriteReport,
} from "../../pipeline/pipeline.service";
import type { DatasetAdded } from "../../pipeline/write-dataset";

type Failing<A> = Effect.Effect<A, { reason: string }>;

// What the Mastra side needs from the application: the steps of the workflows and the tools the
// Studio runs. The port lives here and Nest implements it (`pipeline/port.ts`). The Mastra instance
// is built at import time, before Nest exists, so nothing on this side can be injected.
export type PipelinePort = {
  ingest(run: StepRun): Failing<IngestReport>;
  write(run: StepRun): Failing<WriteReport>;
  build(run: StepRun): Failing<BuildReport>;
  send(run: SendRun): Failing<SendReport>;
  // The one e-mail to the owners about a step that gave up. Never fails.
  alert(step: string, reason: string): Effect.Effect<void>;
  deliveryStatus(date: string | undefined): Failing<DeliveryStatus>;
  editionHtml(date: string | undefined): Failing<EditionHtml>;
  addToWriteDataset(date: string | undefined): Failing<DatasetAdded>;
};

export type EditionContext = { pipeline: PipelinePort };
export type EditionRequestContext = RequestContext<EditionContext>;

export class MissingRunContext extends Data.TaggedError("MissingRunContext")<{ step: string; reason: string }> {}

// Filled once by Nest at boot. A run can start from the jobs route or from the Studio, and the
// Studio starts it from a form — JSON, with no live service in it. So a step looks here when the
// run context carries nothing, and every run of the process meets the same services.
let bound: PipelinePort | undefined;

export function bindPipeline(port: PipelinePort | undefined): void {
  bound = port;
}

// The run context wins, which is how a test hands a step its own pipeline. A step that finds
// neither fails here, named, instead of later inside a call to nothing: a process with no Nest
// around it.
export const editionContext = (
  step: string,
  requestContext: EditionRequestContext | undefined,
): Effect.Effect<EditionContext, MissingRunContext> => {
  const pipeline = requestContext?.get("pipeline") ?? bound;
  return pipeline
    ? Effect.succeed({ pipeline })
    : new MissingRunContext({ step, reason: `step ${step} ran with no pipeline in the run context or the process` });
};
