import { Mastra } from "@mastra/core";
import { MastraEditor } from "@mastra/editor";
import { PostgresStore } from "@mastra/pg";
import { loadConfig } from "../config";
import { POOL_MAX } from "../prisma/pool";
import { editor } from "./agents/editor";
import { scratchEditorDir } from "./paths";
import { studioTools } from "./tools/studio";
import { editionWorkflow } from "./workflows/edition";
import { sendWorkflow } from "./workflows/send";

// The same validated configuration the API boots on: a missing DATABASE_URL fails here, by name,
// instead of becoming an empty connection string that only breaks at the first query.
const config = loadConfig();

// What only the Studio of a development machine carries: the Editor tab, the traces and the scores.
// The traces and the scores come from development dependencies that the deployed image does not
// carry, so they are loaded here, by `require`, and only where the Studio is served.
function studioOnly() {
  if (!config.STUDIO_ENABLED) return {};
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const extras = require("./studio-extras") as typeof import("./studio-extras");
  return {
    // The agent's text lives in the code alone: the instructions in prompts/, the skills in skills/.
    // The Editor tab is a scratchpad for trying a change: what it writes goes to a folder git
    // ignores and never reaches an image, so a try cannot ship by accident and no environment runs a
    // text other than the one in the repository.
    editor: new MastraEditor({ source: "code", codePath: scratchEditorDir() }),
    observability: extras.studioObservability(),
    // A score is saved under the scorer it names, and experiments pick scorers by id: both need
    // them registered, though a run attaches them call by call (live-scorers.ts).
    scorers: extras.studioScorers,
  };
}

// Workflow state and memory live in the environment's database, schema "mastra", apart from the app
// tables. The pool is capped like Prisma's: see POOL_MAX for the arithmetic.
export const mastra = new Mastra({
  agents: { editor },
  // The generation, and the send so the Studio can run it too. In AWS both run from the jobs
  // function (pipeline/jobs.controller.ts), the generation through this same workflow.
  workflows: { edition: editionWorkflow, send: sendWorkflow },
  // Given to no agent: the Studio lists them under Tools.
  tools: studioTools,
  storage: new PostgresStore({
    id: "argon",
    connectionString: config.DATABASE_URL,
    schemaName: "mastra",
    max: POOL_MAX,
  }),
  ...studioOnly(),
});
