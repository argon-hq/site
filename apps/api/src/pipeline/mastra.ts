import { Mastra } from "@mastra/core";
import { writer } from "./agents/writer";

// Sem storage por enquanto: nada persiste até a migration (ARG-94).
export const mastra = new Mastra({
  agents: { writer },
});
