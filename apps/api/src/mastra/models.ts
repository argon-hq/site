import type { MastraModelConfig } from "@mastra/core/llm";

// One model per agent, overridable by MODEL_<AGENT>. Claude through the Anthropic API;
// Mastra's model router reads ANTHROPIC_API_KEY. Fallback providers come later.
const defaults = {
  editor: "claude-sonnet-5",
} as const;

export type AgentName = keyof typeof defaults;

export function modelFor(agent: AgentName): MastraModelConfig {
  const id = process.env[`MODEL_${agent.toUpperCase()}`] ?? defaults[agent];
  return `anthropic/${id}` as MastraModelConfig;
}
