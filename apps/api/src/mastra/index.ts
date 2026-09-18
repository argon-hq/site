import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { writer } from "./agents/writer";

// Workflow state and memory live in the RDS instance, schema "mastra", apart from the app tables.
export const mastra = new Mastra({
  agents: { writer },
  storage: new PostgresStore({
    id: "argon",
    connectionString: process.env.DATABASE_URL ?? "",
    schemaName: "mastra",
  }),
});
