import type { MastraModelConfig } from "@mastra/core/llm";
import { PROFILE } from "../pipeline/profile";

// One model per agent, overridable by MODEL_<AGENT>. Claude through the Anthropic API;
// Mastra's model router reads ANTHROPIC_API_KEY. Fallback providers come later.
// The default comes from the environment's profile: production writes the edition people read, the
// other three are testing the pipeline and do it on a cheaper model.
// The judge scores the Editor's work and the guard screens the pages it reads: both are small,
// repeated classifications, so they run on the cheapest model everywhere.
const defaults = {
  editor: PROFILE.model,
  judge: "claude-haiku-4-5-20251001",
  guard: "claude-haiku-4-5-20251001",
};

export type AgentName = keyof typeof defaults;

export function modelFor(agent: AgentName): MastraModelConfig {
  const id = process.env[`MODEL_${agent.toUpperCase()}`] ?? defaults[agent];
  return `anthropic/${id}` as MastraModelConfig;
}
