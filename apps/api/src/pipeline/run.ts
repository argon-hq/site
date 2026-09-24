import { editionDate } from "./rules";

// The generation runs Monday to Saturday at 5h30 in São Paulo; Sunday has no edition. The clock
// lives in Nest and not in `createWorkflow({ schedule })`: the declarative schedule only runs on the
// evented engine, whose pubsub is in memory and never started by `@mastra/nestjs`, so it would not
// survive the process going down.
export const SCHEDULE = "30 5 * * 1-6";

// The edition goes out an hour and a half after the generation starts, so a run that had to try a
// step again has still finished by then. Same days: an edition nobody generated has nothing to send,
// and the sending step says so instead of mailing anything.
export const SEND_SCHEDULE = "0 7 * * 1-6";

// An hour after the send: an edition still on its way by then is stuck, not slow (see watch.ts).
export const WATCH_SCHEDULE = "0 8 * * 1-6";

// Sunday has no edition, but the alarms that watch for a missing generation and a missing send
// count by calendar day and would fire every Sunday. On Sunday the two clocks tick anyway, at the
// same hours, and only say so: the log line is the heartbeat the alarm reads.
export const SUNDAY_SCHEDULE = "30 5 * * 0";
export const SUNDAY_SEND_SCHEDULE = "0 7 * * 0";

export const TIMEZONE = "America/Sao_Paulo";

// How many times a step tries again before the run gives up.
export const STEP_RETRIES = 2;

// The day a run is for, the way the edition date column stores it: the São Paulo calendar day.
export function runDate(now: Date): string {
  return editionDate(now).toISOString().slice(0, 10);
}

export type RunFailure = { step: string; reason: string };

type StepResult = { status?: string; error?: unknown };
type WorkflowResult = { status: string; error?: unknown; steps?: Record<string, StepResult> };

// What the workflow result says went wrong, for a run that did not succeed: the step that failed
// and why. Mastra keeps one result per step, so the failure is reported with an address instead of a
// bare "the run failed".
export function runFailure(result: WorkflowResult): RunFailure {
  const ended = `workflow ended ${result.status}`;
  const failed = Object.entries(result.steps ?? {}).find(([, step]) => step.status === "failed");
  return failed
    ? { step: failed[0], reason: messageOf(failed[1].error) || ended }
    : { step: "run", reason: messageOf(result.error) || ended };
}

function messageOf(error: unknown): string {
  if (error === undefined || error === null) return "";
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error) return String(error.message);
  return JSON.stringify(error);
}
