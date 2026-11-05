import { Mastra } from "@mastra/core";
import { MastraEditor } from "@mastra/editor";
import { PostgresStore } from "@mastra/pg";
import { loadConfig } from "../config";
import { POOL_MAX } from "../prisma/pool";
import { editor } from "./agents/editor";
import { scratchEditorDir } from "./paths";
import { editionWorkflow } from "./workflows/edition";

// The same validated configuration the API boots on: a missing DATABASE_URL fails here, by name,
// instead of becoming an empty connection string that only breaks at the first query.
const config = loadConfig();

// Workflow state and memory live in the environment's database, schema "mastra", apart from the app
// tables. The pool is capped like Prisma's: see POOL_MAX for the arithmetic.
export const mastra = new Mastra({
  agents: { editor },
  workflows: { edition: editionWorkflow },
  storage: new PostgresStore({
    id: "argon",
    connectionString: config.DATABASE_URL,
    schemaName: "mastra",
    max: POOL_MAX,
  }),
  // The agent's text lives in the code alone: the instructions in prompts/, the skills in skills/.
  // The Studio's Editor tab is a scratchpad for trying a change on a development machine: what it
  // writes goes to a folder git ignores and never reaches an image, so a try cannot ship by accident
  // and no environment runs a text other than the one in the repository. Where the Studio is not
  // served — every deployed function — there is no Editor at all.
  ...(config.STUDIO_ENABLED ? { editor: new MastraEditor({ source: "code", codePath: scratchEditorDir() }) } : {}),
});
