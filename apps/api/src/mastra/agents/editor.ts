import path from "node:path";
import { Agent } from "@mastra/core/agent";
import { modelFor } from "../models";
import { editorInstructions } from "../prompts/editor";
import { readPage } from "../tools/read-page";
import { recentArticles } from "../tools/recent-articles";
import { webSearch } from "../tools/web-search";

// Skills are Markdown folders copied next to the compiled code (nest-cli assets).
const skillsDir = path.resolve(__dirname, "../skills");

// The only agent. One skill per pipeline step; the step prompt names the skill to load.
// The agent judges; persistence and limits stay in code (see src/pipeline).
export const editor = new Agent({
  id: "editor",
  name: "Editor",
  instructions: editorInstructions,
  model: modelFor("editor"),
  tools: { web_search: webSearch, read_page: readPage, recent_articles: recentArticles },
  skills: [path.join(skillsDir, "collect")],
});
