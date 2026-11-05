import { createTool } from "@mastra/core/tools";
import { Effect } from "effect";
import { z } from "zod";
import { editionContext, type EditionRequestContext, type PipelinePort } from "../workflows/context";

// The Studio's tools. They are registered on the instance and given to no agent: the Studio lists
// them under Tools, each with a form and a Run button. They only read, except the dataset one, which
// writes Mastra's own tables.

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

// The inputs are parsed again inside `execute`: what Mastra types the input as depends on its zod
// version, and the lint cannot follow it.
const dayInput = z.object({
  date: z.iso.date().optional().describe("YYYY-MM-DD, São Paulo. Empty: today."),
});

const counts = z.record(z.string(), z.number());

export const deliveryStatus = createTool({
  id: "delivery_status",
  description:
    "Where a day's edition is on its way out: its state, the deliveries by status, each batch and the first errors.",
  inputSchema: dayInput,
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
    operate("delivery_status", (pipeline) => pipeline.deliveryStatus(dayInput.parse(input).date))(
      context.requestContext,
    ),
});

export const editionHtml = createTool({
  id: "edition_html",
  description:
    "The e-mail the building step stored for a day — HTML and plain text, one copy for everyone (the unsubscribe link still carries the placeholder). Null when the edition was not built.",
  inputSchema: dayInput,
  outputSchema: z.object({
    date: z.string(),
    status: z.string(),
    subject: z.string().nullable(),
    html: z.string().nullable(),
    text: z.string().nullable(),
  }),
  execute: (input, context) =>
    operate("edition_html", (pipeline) => pipeline.editionHtml(dayInput.parse(input).date))(context.requestContext),
});

export const datasetAddDay = createTool({
  id: "dataset_add_day",
  description:
    "Adds the articles stored on a day, that still have their text, to the `write` dataset, each as the exact prompt the writing step gives the Editor. Run an experiment on it (Datasets → write) to compare a change to the agent on the same articles.",
  inputSchema: dayInput,
  outputSchema: z.object({ dataset: z.string(), date: z.string(), added: z.number(), alreadyThere: z.number() }),
  execute: (input, context) =>
    operate("dataset_add_day", (pipeline) => pipeline.addToWriteDataset(dayInput.parse(input).date))(
      context.requestContext,
    ),
});

export const studioTools = {
  delivery_status: deliveryStatus,
  edition_html: editionHtml,
  dataset_add_day: datasetAddDay,
};
