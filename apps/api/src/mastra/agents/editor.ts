import path from "node:path";
import { Agent } from "@mastra/core/agent";
import { modelFor } from "../models";
import { editorInstructions } from "../prompts/editor";
import { readPage } from "../tools/read-page";
import { mastraDir } from "../paths";

// Skills are Markdown folders, one per pipeline step; `mastraDir` says where they are in each of
// the two runtimes.
const skillsDir = mastraDir("skills");

// The only agent. One skill per pipeline step; the step prompt names the skill to load.
// The agent judges; persistence and limits stay in code (see src/pipeline). The news is not found by
// the agent: the ingestion lists it from the sources' feeds, by code (src/ingest). `read_page` is
// the one door to the web, and only to the active sources.
export const editor = new Agent({
  id: "editor",
  name: "Editor",
  instructions: editorInstructions,
  model: modelFor("editor"),
  tools: { read_page: readPage },
  skills: [path.join(skillsDir, "write")],
});
