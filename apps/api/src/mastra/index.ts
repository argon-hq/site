import { Mastra } from "@mastra/core";
import { MastraEditor } from "@mastra/editor";
import { PostgresStore } from "@mastra/pg";
import { editor } from "./agents/editor";
import { mastraDir } from "./paths";
import { editionWorkflow } from "./workflows/edition";

// Workflow state and memory live in the same Postgres as the app tables, in their own "mastra" schema.
export const mastra = new Mastra({
  agents: { editor },
  workflows: { edition: editionWorkflow },
  storage: new PostgresStore({
    id: "argon",
    connectionString: process.env.DATABASE_URL ?? "",
    schemaName: "mastra",
  }),
  // The Studio edits the agent's instructions and tools. `source: "code"` keeps what it writes in
  // one JSON file per agent inside the repository, so a change to the prompt is reviewed in a PR and
  // deployed with everything else — instead of living in the database, where each environment could
  // end up with a different text and no history.
  editor: new MastraEditor({ source: "code", codePath: mastraDir("editor") }),
});
