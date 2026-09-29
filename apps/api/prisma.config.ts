import "dotenv/config";
import { defineConfig } from "prisma/config";

// DATABASE_URL comes from .env locally and from the container env in AWS.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
