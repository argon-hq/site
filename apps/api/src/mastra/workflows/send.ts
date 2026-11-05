import { createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { stepOf } from "./step";

// The send as a workflow, so the Studio can run it and show what it did: the report per batch is how
// the delivery is seen on a development machine (and the messages land in Mailpit). In AWS the send
// is the jobs function's `send` job, which calls the same service.

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
    .describe("YYYY-MM-DD, São Paulo. Empty: today. A past day resumes an edition left `sending`."),
});

// No retry: a send that stopped halfway is resumed by running it again, and only what is still
// pending goes out. Trying again in the same second would only meet the same failure.
const sendStep = stepOf({
  id: "send",
  description: "Sends the built edition to every confirmed subscriber, in batches.",
  inputSchema: sendRequestSchema,
  outputSchema: sendReportSchema,
  retries: 0,
  run: (pipeline, { date }, { runId }) =>
    pipeline.send({ date: date ? new Date(`${date}T00:00:00Z`) : undefined, runId }),
});

export const sendWorkflow = createWorkflow({
  id: "send",
  description: "Delivers the day's edition. Running it again only picks up what is still pending.",
  inputSchema: sendRequestSchema,
  outputSchema: sendReportSchema,
})
  .then(sendStep)
  .commit();
