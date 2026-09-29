import { z } from "zod";
import { PROFILE } from "../../pipeline/profile";
import { ALLOWED_DOMAINS } from "../../pipeline/rules";

// Anthropic's server-side web search, restricted to the newsletter's sources. Mastra forwards the
// provider-defined tool to the model; the allowlist and the number of searches are applied by
// Anthropic before results reach the agent, not asked of it in the prompt.
export const webSearch = {
  type: "provider-defined" as const,
  id: "anthropic.web_search_20250305" as const,
  name: "web_search",
  args: {
    maxUses: PROFILE.maxSearches,
    allowedDomains: [...ALLOWED_DOMAINS],
    userLocation: { type: "approximate", country: "BR", timezone: "America/Sao_Paulo" },
  },
  inputSchema: z.object({ query: z.string() }),
};
