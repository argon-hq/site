import { z } from "zod";
import { deploymentSchema } from "./pipeline/profile";

// Environment is the only configuration source; in AWS it comes from Parameter Store.
const schema = z
  .object({
    // Only production gets the JSON logs; anything else reads better on a terminal.
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url(),
    ANTHROPIC_API_KEY: z.string().min(1),
    INTERNAL_API_SECRET: z.string().min(16),
    // What the unsubscribe tokens are derived from (src/subscriber/token.ts). Its own secret, apart from
    // the internal one: the internal secret is shared with the site and rotates with it, and rotating
    // this one invalidates every unsubscribe link already in an inbox.
    UNSUBSCRIBE_TOKEN_SECRET: z.string().min(32),
    PORT: z.coerce.number().default(3001),

    // The internal clock: 5h30 generation, Monday to Saturday. Off by default, so a machine that only
    // runs the API for a while never wakes the agents up on its own; the run stays one POST away.
    SCHEDULER_ENABLED: z.stringbool().default(false),

    // Mastra Studio, served by this API under /studio (src/studio). Off by default: it is a working
    // tool for dev and lab, where looking at the agents is the point, and production has no reason to
    // answer anything there. The bundle it serves is public; the agents behind it are not.
    STUDIO_ENABLED: z.stringbool().default(false),

    // Which environment this is. The value decides how much a run may cost — the model, how far the
    // agent may search and whether it runs at all or over a fixture (see pipeline/profile.ts). Nothing
    // reads it from here: the profile resolves it, and this entry is what refuses an unknown value and
    // what demands one in production, where falling back to the mocked profile would mail a fake
    // edition to real subscribers. The deploy writes it, so it cannot disagree with where it landed.
    ARGON_ENV: deploymentSchema.optional(),

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
  })
  // A development machine is `local` by default; a container has to say where it is.
  .refine((c) => c.NODE_ENV !== "production" || c.ARGON_ENV !== undefined, {
    message: "ARGON_ENV is required in production",
    path: ["ARGON_ENV"],
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
