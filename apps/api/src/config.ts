import { z } from "zod";

// Environment is the only configuration source; in AWS it comes from Parameter Store.
const schema = z.object({
  // Only production gets the JSON logs; anything else reads better on a terminal.
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  INTERNAL_API_SECRET: z.string().min(16),
  PORT: z.coerce.number().default(3001),

  // Where the two halves answer from. They go into the links of every e-mail, so they are absolute
  // and per environment: the site serves the unsubscribe page, the API the one-click endpoint.
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  API_ORIGIN: z.string().url().default("http://localhost:3001"),

  // Mail. Resend delivers for real, so it is never the default: a development machine sends to
  // the local Mailpit, and only an explicit MAIL_TRANSPORT=resend reaches a real inbox.
  MAIL_TRANSPORT: z.enum(["smtp", "resend"]).default("smtp"),
  SMTP_URL: z.string().url().default("smtp://localhost:1025"),
  RESEND_API_KEY: z.string().optional(),
})
  // The key is only required by the provider that uses it.
  .refine((c) => c.MAIL_TRANSPORT !== "resend" || Boolean(c.RESEND_API_KEY), {
    message: "RESEND_API_KEY is required when MAIL_TRANSPORT=resend",
    path: ["RESEND_API_KEY"],
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
