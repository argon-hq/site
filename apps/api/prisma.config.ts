import "dotenv/config";
import { defineConfig } from "prisma/config";

// DATABASE_URL comes from .env locally and, in AWS, from the jobs function's environment, loaded
// from the Parameter Store (the deploy's migrate job, src/pipeline/migrate.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
