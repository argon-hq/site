import type { MastraModelConfig } from "@mastra/core/llm";

// One model per agent, overridable by MODEL_<AGENT>. Claude through the Anthropic API;
// Mastra's model router reads ANTHROPIC_API_KEY. Fallback providers come later.
const defaults: Record<string, string> = {
  writer: "claude-sonnet-5",
};

export function modelFor(agent: keyof typeof defaults): MastraModelConfig {
  const id = process.env[`MODEL_${agent.toUpperCase()}`] ?? defaults[agent];
  return `anthropic/${id}` as MastraModelConfig;
}
