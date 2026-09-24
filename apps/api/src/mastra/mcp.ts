import { MCPServer } from "@mastra/mcp";
import { operatorTools } from "./tools/operator";

// The operator's tools as an MCP server, so an MCP client — Claude Code, for one — can ask where the
// day's delivery stands or change a clock without opening the Studio. Mastra serves it under
// /mastra/mcp/argon/mcp (streamable HTTP), behind the same x-internal-secret as every other Mastra
// route. Only the tools: the workflows and the agent stay behind the Studio and the pipeline routes.
//
// 1.x on purpose: 2.x speaks only the 2026-07-28 revision of the protocol and refuses older clients.
export const argonMcp = new MCPServer({
  id: "argon",
  name: "Argon operator",
  version: "1.0.0",
  description: "The clocks of the day and the delivery of the Argon newsletter, for its operator.",
  instructions:
    "Tools to read and change the newsletter's schedules (generation 5h30, send 7h, watch 8h, retention 4h, America/Sao_Paulo) and to read where a day's delivery stands. Times in the answers are UTC.",
  tools: operatorTools,
});
