import type { RequestContext } from "@mastra/core/request-context";
import { Data, Effect } from "effect";
import type {
  BuildReport,
  CollectReport,
  SendReport,
  SendRun,
  StepRun,
  WriteReport,
} from "../../pipeline/pipeline.service";
import type { DeliveryStatus } from "../../pipeline/delivery-status";
import type { DatasetAdded } from "../../pipeline/write-dataset";
import type { RetentionReport } from "../../pipeline/retention";
import type { ScheduleView, ScheduleChange } from "../../pipeline/schedules";
import type { StuckEdition } from "../../pipeline/watch";

type Failing<A> = Effect.Effect<A, { reason: string }>;

// What the Mastra side needs from the application: the steps of the workflows and the operator's
// tools. The port lives here and Nest implements it (`pipeline/port.ts`). The Mastra instance is
// built at import time, before Nest exists, so nothing on this side can be injected.
export type PipelinePort = {
  collect(run: StepRun): Failing<CollectReport>;
  write(run: StepRun): Failing<WriteReport>;
  build(run: StepRun): Failing<BuildReport>;
  send(run: SendRun): Failing<SendReport>;
  watch(): Failing<StuckEdition[]>;
  retention(): Failing<RetentionReport>;
  heartbeat(kind: "generate" | "send"): Effect.Effect<void>;
  // The one e-mail to the owners about a step that gave up. Never fails.
  alert(step: string, reason: string): Effect.Effect<void>;
  deliveryStatus(date: string | undefined): Failing<DeliveryStatus>;
  schedules(): Failing<ScheduleView[]>;
  changeSchedule(change: ScheduleChange): Failing<ScheduleView>;
  runSchedule(id: string): Failing<{ scheduleId: string; runId: string }>;
  resetSchedules(id: string | undefined): Failing<ScheduleView[]>;
  addToWriteDataset(date: string | undefined): Failing<DatasetAdded>;
};

export type EditionContext = { pipeline: PipelinePort };
export type EditionRequestContext = RequestContext<EditionContext>;

export class MissingRunContext extends Data.TaggedError("MissingRunContext")<{ step: string; reason: string }> {}

// Filled once by Nest at boot. A run can start in three places — the route, the Studio and the
// scheduler — and only the route can hand a live service through the run context: the other two
// start from JSON (a form, a schedule row) and the evented engine the scheduler uses serializes the
// context besides. So the steps look here when the context carries nothing, and every run of the
// process meets the same service.
let bound: PipelinePort | undefined;

export function bindPipeline(port: PipelinePort | undefined): void {
  bound = port;
}

// The run context wins, which is how a test hands a step its own pipeline. A step that finds
// neither fails here, named, instead of later inside a call to nothing: it is a process without
// Nest around it, like a `mastra dev` of its own.
export const editionContext = (
  step: string,
  requestContext: EditionRequestContext | undefined,
): Effect.Effect<EditionContext, MissingRunContext> => {
  const pipeline = requestContext?.get("pipeline") ?? bound;
  return pipeline
    ? Effect.succeed({ pipeline })
    : new MissingRunContext({ step, reason: `step ${step} ran with no pipeline in the run context or the process` });
};
