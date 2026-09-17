import { z } from "zod";

// Environment is the only configuration source; in AWS it comes from Parameter Store.
const schema = z.object({
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  INTERNAL_API_SECRET: z.string().min(16),
  PORT: z.coerce.number().default(3001),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid configuration: ${missing}`);
  }
  return result.data;
}
