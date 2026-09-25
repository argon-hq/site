import type { MastraModelConfig } from "@mastra/core/llm";
import { PROFILE } from "../pipeline/profile";

// One model per agent, overridable by MODEL_<AGENT>. Claude through the Anthropic API;
// Mastra's model router reads ANTHROPIC_API_KEY. Fallback providers come later.
// The default comes from the environment's profile: production writes the edition people read, the
// other three are testing the pipeline and do it on a cheaper model.
const defaults = {
  editor: PROFILE.model,
};

export type AgentName = keyof typeof defaults;

export function modelFor(agent: AgentName): MastraModelConfig {
  const id = process.env[`MODEL_${agent.toUpperCase()}`] ?? defaults[agent];
  return `anthropic/${id}` as MastraModelConfig;
}
