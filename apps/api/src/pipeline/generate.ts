import type { Agent } from "@mastra/core/agent";
import type { MastraScorers } from "@mastra/core/evals";
import type { TracingContext } from "@mastra/core/observability";
import type { RequestContext } from "@mastra/core/request-context";
import type { z } from "zod";
import { sumUsage } from "./write";

// A step that uses tools cannot answer under a schema in the same call.
//
// Anthropic's structured output constrains *every* assistant turn, not just the last one. The first
// turn of a tool-using step only wants to load the skill and say it is starting — and that turn is
// forced into the shape of the final answer, so it comes back as an empty husk:
//
//   {"candidates": [], "discarded": 0, "notes": "Skill carregada com sucesso."}  + tool_use: skill
//
// The run ends there, on an answer nobody worked for: no search, no page read. Without the schema
// the same turn is plain prose and the agent goes on working, which is how this was found.
//
// So the work and the shape are two calls. The agent works with its tools and answers in prose;
// then a second call, with `toolChoice: "none"` so there is nothing to call and no step to spend,
// casts that prose into the schema. Both usages are added up, because the cost of a step is the
// cost of both halves.

// The steps and the tool calls are the working half's, and they stay in the report: a step that
// stops calling tools is how this bug showed itself, and it is what a later one would show too.
export type Structured<A> = {
  object: A;
  usage: Record<string, number>;
  steps: number | null;
  toolCalls: string[];
};

const SHAPE_REQUEST = [
  "Abaixo está o resultado do seu próprio trabalho.",
  "Converta-o para o formato pedido, sem pesquisar e sem acrescentar nada que não esteja no texto.",
  "",
].join("\n");

export class NothingToShape extends Error {
  constructor(what: string) {
    super(`the second call returned no object when shaping ${what}`);
  }
}

// What a call carries for the Studio, beyond the work itself: the span it hangs under — Mastra has no
// implicit parent, so without it every call is a trace of its own instead of a child of the step
// that made it — the metadata the trace is found by, and the scorers that judge the work.
export type CallObservation = {
  tracingContext?: TracingContext;
  metadata?: Record<string, unknown>;
  scorers?: MastraScorers;
};

// Generic over the context because `RequestContext` is contravariant in it: a fixed type here would
// refuse every caller's own context.
export async function generateStructured<S extends z.ZodType, C>(
  agent: Agent,
  prompt: string,
  options: { schema: S; maxSteps?: number; requestContext?: RequestContext<C> } & CallObservation,
): Promise<Structured<z.infer<S>>> {
  const { schema, maxSteps, requestContext, tracingContext, metadata, scorers } = options;
  const traced = {
    ...(tracingContext ? { tracingContext } : {}),
    ...(metadata ? { tracingOptions: { metadata } } : {}),
  };

  const worked = await agent.generate(prompt, {
    ...(requestContext ? { requestContext } : {}),
    ...(maxSteps ? { maxSteps } : {}),
    ...traced,
    ...(scorers ? { scorers } : {}),
  });

  // The scorers are the working call's alone: per-call scorers replace the agent's, so an empty set
  // keeps the shaping, which only restates the answer, out of the scores.
  const shaped = await agent.generate(`${SHAPE_REQUEST}${worked.text ?? ""}`, {
    structuredOutput: { schema },
    toolChoice: "none",
    maxSteps: 1,
    ...traced,
    scorers: {},
  });

  if (shaped.object == null) throw new NothingToShape(schema.description ?? "the answer");

  return {
    object: shaped.object as z.infer<S>,
    usage: sumUsage([worked.usage, shaped.usage]),
    steps: worked.steps?.length ?? null,
    toolCalls: (worked.toolCalls ?? []).map((call) => call.payload?.toolName ?? "?"),
  };
}
