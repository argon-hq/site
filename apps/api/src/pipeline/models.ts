import type { MastraModelConfig } from "@mastra/core/llm";
import { createClaudeCode } from "ai-sdk-provider-claude-code";

// Modelo por agente, via ambiente (ARG-93).
// claude-code: créditos da sessão do Claude Code, pela CLI logada. Uso local.
// anthropic: chave de API pelo roteador do Mastra. Uso em produção.
const provider = process.env.MODEL_PROVIDER ?? "anthropic";

const claudeCode = createClaudeCode({
  // Só geração de texto: sem o prompt do Claude Code, sem ferramentas nativas e sem
  // conectores MCP da conta. As instruções do agente vão na própria mensagem.
  defaultSettings: {
    systemPrompt: "",
    tools: [],
    mcpServers: {},
    strictMcpConfig: true,
    maxTurns: 1,
  },
});

export function modelFor(agent: "writer"): MastraModelConfig {
  const id = process.env[`MODEL_${agent.toUpperCase()}`];
  if (provider === "claude-code") return claudeCode(id ?? "sonnet");
  return `anthropic/${id ?? "claude-sonnet-5"}` as MastraModelConfig;
}
