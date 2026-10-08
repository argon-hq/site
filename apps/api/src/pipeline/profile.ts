import { z } from "zod";

// Where this process is running. The four environments share one code base and one pipeline; what
// changes is how much a run is allowed to cost. The model is not one of these: every environment
// runs the same one, per step, from `mastra/models.ts`. Everything below is a dial, never a rule: what an
// edition may contain lives in `rules.ts` and is the same everywhere.
export const deploymentSchema = z.enum(["local", "lab", "dev", "prod"]);
export type Deployment = z.infer<typeof deploymentSchema>;

// `live` runs the agent. `mock` runs the same steps over a fixture, so the pipeline can be exercised
// end to end without paying for judgement that is not being tested.
export type Mode = "live" | "mock";

export type Profile = {
  mode: Mode;
  // The longest page text the writing step works from. The news is listed by code, for free; the
  // model pays for every character it reads.
  maxTextChars: number;
  // How many pages one writing run may open: the representative of a ficha, then the next member
  // of its group when that one is closed. Spent, the run writes from the feed's text or drops the
  // ficha. Twice the edition is enough for a paywall or two; more is a run reading the whole web.
  maxReads: number;
  // Defaults of the settings that shape the edition. A row in the settings table still wins.
  minArticles: number;
  maxArticles: number;
};

// Lab and local are mocked, but they carry numbers anyway: a run forced to `live` there is already
// cheap, instead of depending on someone remembering to turn the dials down first.
export const PROFILES: Record<Deployment, Profile> = {
  prod: {
    mode: "live",
    maxTextChars: 12_000,
    maxReads: 12,
    minArticles: 3,
    maxArticles: 6,
  },
  dev: {
    mode: "live",
    maxTextChars: 6_000,
    maxReads: 8,
    minArticles: 2,
    maxArticles: 4,
  },
  lab: {
    mode: "mock",
    maxTextChars: 4_000,
    maxReads: 6,
    minArticles: 1,
    maxArticles: 3,
  },
  local: {
    mode: "mock",
    maxTextChars: 4_000,
    maxReads: 6,
    minArticles: 1,
    maxArticles: 3,
  },
};

// Read at import, not by injection: the tools have no Nest around them, the same reason `models.ts`
// reads MODEL_<STEP> from the environment.
// An unknown value is refused here, in the same words `loadConfig` would use — this runs first,
// while the modules are still loading, so its message is the one that gets seen; a missing one is
// a development machine.
export const DEPLOYMENT: Deployment = readDeployment(process.env.ARGON_ENV);

export function readDeployment(value: string | undefined): Deployment {
  const parsed = deploymentSchema.safeParse(value ?? "local");
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration: ARGON_ENV must be one of ${deploymentSchema.options.join(", ")}, got "${value}"`,
    );
  }
  return parsed.data;
}
export const PROFILE: Profile = PROFILES[DEPLOYMENT];

// What a run actually does. Outside production the caller may ask for the other mode — the point of
// `live` in the lab. Production never runs on a fixture, whoever asks: a mocked edition would reach
// real subscribers.
export function resolveMode(deployment: Deployment, requested?: Mode): Mode {
  if (deployment === "prod") return "live";
  return requested ?? PROFILES[deployment].mode;
}
