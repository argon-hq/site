import { Mastra } from "@mastra/core";
import { MastraEditor } from "@mastra/editor";
import { PostgresStore } from "@mastra/pg";
import { loadConfig } from "../config";
import { POOL_MAX } from "../prisma/pool";
import { editor } from "./agents/editor";
import { mastraDir } from "./paths";
import { editionWorkflow } from "./workflows/edition";

// The same validated configuration the API boots on: a missing DATABASE_URL fails here, by name,
// instead of becoming an empty connection string that only breaks at the first query.
const config = loadConfig();

// Workflow state and memory live in the Postgres container, schema "mastra", apart from the app
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
  // The Studio edits the agent's instructions and tools. `source: "code"` keeps what it writes in
  // one JSON file per agent inside the repository, so a change to the prompt is reviewed in a PR and
  // deployed with everything else — instead of living in the database, where each environment could
  // end up with a different text and no history.
  editor: new MastraEditor({ source: "code", codePath: mastraDir("editor") }),
});
