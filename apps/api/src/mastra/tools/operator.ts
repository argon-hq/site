import { createTool } from "@mastra/core/tools";
import { Effect } from "effect";
import { z } from "zod";
import { editionContext, type EditionRequestContext, type PipelinePort } from "../workflows/context";

// The operator's tools. They are registered on the instance and never given to an agent: the
// Studio lists them under Tools, each with a form and a Run button, and that is how the clocks are
// changed and the delivery is read without leaving it. The Studio's own schedule page only lists,
// pauses and resumes; these do the rest, through the same Mastra service.

// A tool reports failure by throwing, which the Studio shows as the result.
const operate =
  <A>(tool: string, run: (pipeline: PipelinePort) => Effect.Effect<A, { reason: string }>) =>
  (requestContext: unknown): Promise<A> =>
    Effect.runPromise(
      editionContext(tool, requestContext as EditionRequestContext | undefined).pipe(
        Effect.flatMap(({ pipeline }) => run(pipeline)),
        Effect.mapError((error) => new Error(error.reason)),
      ),
    );

const scheduleId = z
  .string()
  .min(1)
  .describe("edition, send, watch, retention, edition-sunday or send-sunday (as schedules_list shows)");

const scheduleView = z.object({
  id: z.string(),
  workflowId: z.string(),
  description: z.string().nullable(),
  cron: z.string(),
  timezone: z.string().nullable(),
  status: z.enum(["active", "paused"]),
  inputData: z.unknown(),
  nextFireAt: z.string().nullable(),
  lastFireAt: z.string().nullable(),
  lastRunId: z.string().nullable(),
  code: z.object({ cron: z.string(), timezone: z.string(), inputData: z.record(z.string(), z.unknown()) }).nullable(),
  differsFromCode: z.array(z.string()),
});

export const schedulesList = createTool({
  id: "schedules_list",
  description:
    "Every clock of the day: cron, zone, status, next and last fire, and what the code says it should be. Times in UTC.",
  inputSchema: z.object({}),
  outputSchema: z.object({ schedules: z.array(scheduleView) }),
  execute: (_input, context) =>
    operate("schedules_list", (pipeline) => pipeline.schedules().pipe(Effect.map((schedules) => ({ schedules }))))(
      context.requestContext,
    ),
});

// The inputs are parsed again inside `execute`: what Mastra types the input as depends on its zod
// version, and the lint cannot follow it.
const updateInput = z.object({
  id: scheduleId,
  cron: z.string().optional().describe('Five fields, e.g. "30 5 * * 1-6". Evaluated in the schedule\'s zone.'),
  timezone: z.string().optional().describe("IANA zone, e.g. America/Sao_Paulo"),
  mode: z
    .enum(["live", "mock", "profile"])
    .optional()
    .describe("Edition only. profile goes back to the environment's own; production is always live."),
  status: z.enum(["active", "paused"]).optional(),
});

export const scheduleUpdate = createTool({
  id: "schedule_update",
  description:
    "Changes one clock: cron (five fields, in its zone), zone, the edition's mode, or pauses and resumes it. Only what is filled changes; the change survives restarts and deploys until schedule_reset.",
  inputSchema: updateInput,
  outputSchema: scheduleView,
  execute: (input, context) =>
    operate("schedule_update", (pipeline) => pipeline.changeSchedule(updateInput.parse(input)))(context.requestContext),
});

const runInput = z.object({ id: scheduleId });

export const scheduleRun = createTool({
  id: "schedule_run",
  description:
    "Fires one clock now, with its own input, as the cron would. Recorded in the schedule's history as manual; the next fire does not move. Follow the run in Workflows.",
  inputSchema: runInput,
  outputSchema: z.object({ scheduleId: z.string(), runId: z.string() }),
  execute: (input, context) =>
    operate("schedule_run", (pipeline) => pipeline.runSchedule(runInput.parse(input).id))(context.requestContext),
});

const resetInput = z.object({ id: scheduleId.optional() });

export const scheduleReset = createTool({
  id: "schedule_reset",
  description:
    "Puts one clock, or every clock when id is empty, back to what the code says. A paused clock stays paused.",
  inputSchema: resetInput,
  outputSchema: z.object({ schedules: z.array(scheduleView) }),
  execute: (input, context) =>
    operate("schedule_reset", (pipeline) =>
      pipeline.resetSchedules(resetInput.parse(input).id).pipe(Effect.map((schedules) => ({ schedules }))),
    )(context.requestContext),
});

const counts = z.record(z.string(), z.number());

const deliveryInput = z.object({
  date: z.iso.date().optional().describe("YYYY-MM-DD, São Paulo. Empty: today."),
});

export const deliveryStatus = createTool({
  id: "delivery_status",
  description:
    "Where a day's edition is on its way out: its state, the deliveries by status, each batch and the first errors. Read only.",
  inputSchema: deliveryInput,
  outputSchema: z.object({
    date: z.string(),
    edition: z.object({
      id: z.string(),
      status: z.string(),
      subject: z.string().nullable(),
      sentAt: z.string().nullable(),
    }),
    total: z.number(),
    byStatus: counts,
    batches: z.array(z.object({ batch: z.number(), total: z.number(), byStatus: counts })),
    errors: z.array(z.object({ subscriberId: z.string(), batch: z.number(), status: z.string(), error: z.string() })),
  }),
  execute: (input, context) =>
    operate("delivery_status", (pipeline) => pipeline.deliveryStatus(deliveryInput.parse(input).date))(
      context.requestContext,
    ),
});

export const operatorTools = {
  schedules_list: schedulesList,
  schedule_update: scheduleUpdate,
  schedule_run: scheduleRun,
  schedule_reset: scheduleReset,
  delivery_status: deliveryStatus,
};
