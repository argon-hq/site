import { Mastra } from "@mastra/core";
import { MastraEditor } from "@mastra/editor";
import { MastraStorageExporter, Observability } from "@mastra/observability";
import { PostgresStore } from "@mastra/pg";
import { loadConfig } from "../config";
import { POOL_MAX } from "../prisma/pool";
import { editor } from "./agents/editor";
import { argonMcp } from "./mcp";
import { mastraDir } from "./paths";
import { scorers } from "./scorers";
import { operatorTools } from "./tools/operator";
import { editionWorkflow } from "./workflows/edition";
import { heartbeatWorkflow, retentionWorkflow, sendWorkflow, watchWorkflow } from "./workflows/operations";

// The same validated configuration the API boots on: a missing DATABASE_URL fails here, by name,
// instead of becoming an empty connection string that only breaks at the first query.
const config = loadConfig();

// Traces of every agent call — tools, time and tokens — for the Studio to show. Only where the
// Studio is served: the architecture keeps token cost out of storage, and outside production these
// are for looking at a run, not for keeping. The retention workflow deletes them after a month.
const observability = config.STUDIO_ENABLED
  ? new Observability({
      configs: { default: { serviceName: "argon-api", exporters: [new MastraStorageExporter()] } },
    })
  : undefined;

// Workflow state, schedules, traces and memory live in the Postgres container, schema "mastra",
// apart from the app tables. The pool is capped like Prisma's: see POOL_MAX for the arithmetic.
export const mastra = new Mastra({
  agents: { editor },
  // Every clock of the day is a workflow, so the scheduler can fire it and the Studio can run it and
  // show what it did. The schedule rows are created by the API at boot (src/pipeline/schedules.ts).
  workflows: {
    edition: editionWorkflow,
    send: sendWorkflow,
    watch: watchWorkflow,
    retention: retentionWorkflow,
    heartbeat: heartbeatWorkflow,
  },
  // Registered on the instance and on no agent: the operator runs them from the Studio's Tools page,
  // or from an MCP client through the server below.
  tools: operatorTools,
  mcpServers: { argon: argonMcp },
  // A score is saved under the scorer it names, and experiments pick scorers by id: both need them
  // here, though the pipeline attaches them call by call (see scorers.ts).
  scorers,
  storage: new PostgresStore({
    id: "argon",
    connectionString: config.DATABASE_URL,
    schemaName: "mastra",
    max: POOL_MAX,
  }),
  ...(observability ? { observability } : {}),
  // The Studio edits the agent's instructions and tools. `source: "code"` keeps what it writes in
  // one JSON file per agent inside the repository, so a change to the prompt is reviewed in a PR and
  // deployed with everything else — instead of living in the database, where each environment could
  // end up with a different text and no history.
  editor: new MastraEditor({ source: "code", codePath: mastraDir("editor") }),
});
