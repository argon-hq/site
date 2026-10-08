import type { MastraModelConfig } from "@mastra/core/llm";
import { RequestContext } from "@mastra/core/request-context";

// One Claude model per step of the edition, through the Anthropic API (Mastra's router reads
// ANTHROPIC_API_KEY). Haiku on both by default, in every environment: the selection reads twenty
// fichas and answers with a list, the writing reads one page and answers with three hundred
// characters — neither needs more, and the two are the whole cost of a run. MODEL_SELECT and
// MODEL_WRITE change one step without the other. Fallback providers come later.
export const MODEL_STEPS = ["select", "write"] as const;
export type ModelStep = (typeof MODEL_STEPS)[number];

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function modelId(step: ModelStep): string {
  return process.env[`MODEL_${step.toUpperCase()}`] ?? DEFAULT_MODEL;
}

// The Editor is one agent with two steps, so its model is decided per call: the pipeline puts the
// step in the request context and the agent reads it there. A call with no step — the Studio's —
// writes.
export type ModelContext = { step: ModelStep };

export function modelContext(step: ModelStep): RequestContext<ModelContext> {
  const context = new RequestContext<ModelContext>();
  context.set("step", step);
  return context;
}

export function modelOf({ requestContext }: { requestContext: RequestContext<ModelContext> }): MastraModelConfig {
  return `anthropic/${modelId(requestContext.get("step") ?? "write")}` as MastraModelConfig;
}
