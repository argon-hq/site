import { createWorkflow } from "@mastra/core/workflows";
import { Effect } from "effect";
import { z } from "zod";
import { stepOf } from "./step";

// The runs of the day that are not the generation. Each is a workflow so the scheduler can fire it
// and the Studio can show what it did: the send's report per batch is how the delivery is seen.

const batchSchema = z.object({ batch: z.number(), size: z.number(), sent: z.number(), failed: z.number() });

export const sendReportSchema = z.object({
  date: z.string(),
  editionId: z.string(),
  status: z.enum(["sent", "sending"]),
  recipients: z.number(),
  created: z.number(),
  alreadySent: z.number(),
  batches: z.array(batchSchema),
  sent: z.number(),
  failed: z.number(),
  durationMs: z.number(),
});

export const sendRequestSchema = z.object({
  date: z.iso
    .date()
    .optional()
    .describe("YYYY-MM-DD, São Paulo. Empty: today. A past day resumes an edition left `sending` (within 24h)."),
});

// No retry: a send that stopped halfway is resumed by running it again, and only what is still
// pending goes out. Trying again in the same second would only meet the same failure.
const sendStep = stepOf({
  id: "send",
  description: "Sends the built edition to every confirmed subscriber, in batches of 100.",
  inputSchema: sendRequestSchema,
  outputSchema: sendReportSchema,
  retries: 0,
  alert: true,
  run: (pipeline, { date }) => pipeline.send({ date: date ? new Date(`${date}T00:00:00Z`) : undefined }),
});

export const sendWorkflow = createWorkflow({
  id: "send",
  description: "Delivers the day's edition. Running it again only picks up what is still pending.",
  inputSchema: sendRequestSchema,
  outputSchema: sendReportSchema,
})
  .then(sendStep)
  .commit();

const stuckSchema = z.object({
  stuck: z.array(z.object({ id: z.string(), date: z.string(), status: z.string(), updatedAt: z.string() })),
});

const watchStep = stepOf({
  id: "check",
  description: "Looks for an edition left `generating` or `sending` for more than three hours.",
  inputSchema: z.object({}),
  outputSchema: stuckSchema,
  retries: 0,
  // The check mails the owners about what it finds; a check that could not look only logs.
  alert: false,
  run: (pipeline) => pipeline.watch().pipe(Effect.map((stuck) => ({ stuck }))),
});

export const watchWorkflow = createWorkflow({
  id: "watch",
  description: "Finds editions stuck mid-run and tells the owners.",
  inputSchema: z.object({}),
  outputSchema: stuckSchema,
})
  .then(watchStep)
  .commit();

const retentionSchema = z.object({
  textsCleared: z.number(),
  seenUrlsDeleted: z.number(),
  subscribersPurged: z.number(),
  tracesDeleted: z.number(),
});

const retentionStep = stepOf({
  id: "purge",
  description: "Trims what the database keeps past its window.",
  inputSchema: z.object({}),
  outputSchema: retentionSchema,
  retries: 0,
  alert: false,
  run: (pipeline) => pipeline.retention(),
});

export const retentionWorkflow = createWorkflow({
  id: "retention",
  description: "Clears old article text, seen links, cancelled subscribers and traces.",
  inputSchema: z.object({}),
  outputSchema: retentionSchema,
})
  .then(retentionStep)
  .commit();

const heartbeatSchema = z.object({
  kind: z.enum(["generate", "send"]).describe("Which of the day's clocks this beat stands in for."),
});

// Sunday has no edition, but the alarms that watch for a missing generation and a missing send
// count by calendar day. The Sunday schedules fire this instead, and the lines it writes are the
// ones the alarms count.
const heartbeatStep = stepOf({
  id: "beat",
  description: "Writes the log line the daily alarm counts, on a day with no edition.",
  inputSchema: heartbeatSchema,
  outputSchema: heartbeatSchema,
  retries: 0,
  alert: false,
  run: (pipeline, input) => pipeline.heartbeat(input.kind).pipe(Effect.as(input)),
});

export const heartbeatWorkflow = createWorkflow({
  id: "heartbeat",
  description: "Sunday's stand-in for the generation and the send.",
  inputSchema: heartbeatSchema,
  outputSchema: heartbeatSchema,
})
  .then(heartbeatStep)
  .commit();
