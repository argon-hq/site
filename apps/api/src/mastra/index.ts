import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { editor } from "./agents/editor";

// Workflow state and memory live in the RDS instance, schema "mastra", apart from the app tables.
export const mastra = new Mastra({
  agents: { editor },
  storage: new PostgresStore({
    id: "argon",
    connectionString: process.env.DATABASE_URL ?? "",
    schemaName: "mastra",
  }),
});
