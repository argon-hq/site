import { Agent } from "@mastra/core/agent";
import { modelFor } from "../models";
import { writerInstructions } from "../prompts/writer";

export const writer = new Agent({
  id: "writer",
  name: "Redator",
  instructions: writerInstructions,
  model: modelFor("writer"),
});
