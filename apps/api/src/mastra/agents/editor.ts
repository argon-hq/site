import { existsSync } from "node:fs";
import path from "node:path";
import { Agent } from "@mastra/core/agent";
import { modelFor } from "../models";
import { editorInstructions } from "../prompts/editor";
import { readPage } from "../tools/read-page";
import { recentArticles } from "../tools/recent-articles";
import { webSearch } from "../tools/web-search";

// Skills are Markdown folders that live in the source tree and are copied next to the compiled code
// by the nest-cli assets. `__dirname` cannot name both: the Studio runs an ESM bundle, where it does
// not exist, and the API runs CommonJS, where `import.meta` does not. So the directory is named from
// the working directory, which is `apps/api` in `nest start`, in `mastra dev` and in the container
// alike. The sources come first, so a skill edited by hand is read without a build; the image ships
// only the compiled copy.
const SKILL_DIRS = ["src/mastra/skills", "dist/mastra/skills"];
const skillsDir = path.resolve(SKILL_DIRS.find((dir) => existsSync(path.resolve(dir))) ?? SKILL_DIRS[1]);

// The only agent. One skill per pipeline step; the step prompt names the skill to load.
// The agent judges; persistence and limits stay in code (see src/pipeline).
export const editor = new Agent({
  id: "editor",
  name: "Editor",
  instructions: editorInstructions,
  model: modelFor("editor"),
  tools: { web_search: webSearch, read_page: readPage, recent_articles: recentArticles },
  skills: [path.join(skillsDir, "collect"), path.join(skillsDir, "write")],
});
