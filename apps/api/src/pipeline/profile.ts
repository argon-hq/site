import { z } from "zod";

// Where this process is running. The four environments share one code base and one pipeline; what
// changes is how much a run is allowed to cost. Everything below is a dial, never a rule: what an
// edition may contain lives in `rules.ts` and is the same everywhere.
export const deploymentSchema = z.enum(["local", "lab", "dev", "prod"]);
export type Deployment = z.infer<typeof deploymentSchema>;

// `live` runs the agent. `mock` runs the same steps over a fixture, so the pipeline can be exercised
// end to end without paying for judgement that is not being tested.
export type Mode = "live" | "mock";

export type Profile = {
  mode: Mode;
  model: string;
  // One collection run: how much the agent may search and how many turns it gets in total.
  minSearches: number;
  maxSearches: number;
  // How many pages one collection opens. The search brings a title and a snippet; only the page
  // says whether the news is real, recent and worth a line — so reading is the work of the step and
  // not a cost to be spared. The floor is what keeps a run from judging thirty results by their
  // headlines and reading three.
  minReads: number;
  maxReads: number;
  maxSteps: number;
  maxTextChars: number;
  // Defaults of the settings that shape the edition. A row in the settings table still wins.
  scoreCutoff: number;
  minArticles: number;
  maxArticles: number;
};

// Lab and local are mocked, but they carry numbers anyway: a run forced to `live` there is already
// cheap, instead of depending on someone remembering to turn the dials down first.
export const PROFILES: Record<Deployment, Profile> = {
  prod: {
    mode: "live",
    model: "claude-sonnet-5",
    minSearches: 6,
    maxSearches: 12,
    minReads: 12,
    maxReads: 20,
    maxSteps: 60,
    maxTextChars: 12_000,
    scoreCutoff: 3,
    minArticles: 3,
    maxArticles: 6,
  },
  dev: {
    mode: "live",
    model: "claude-haiku-4-5-20251001",
    minSearches: 3,
    maxSearches: 5,
    minReads: 8,
    maxReads: 14,
    maxSteps: 40,
    maxTextChars: 6_000,
    scoreCutoff: 2,
    minArticles: 2,
    maxArticles: 4,
  },
  lab: {
    mode: "mock",
    model: "claude-haiku-4-5-20251001",
    minSearches: 2,
    maxSearches: 3,
    minReads: 3,
    maxReads: 6,
    maxSteps: 18,
    maxTextChars: 4_000,
    scoreCutoff: 2,
    minArticles: 1,
    maxArticles: 3,
  },
  local: {
    mode: "mock",
    model: "claude-haiku-4-5-20251001",
    minSearches: 2,
    maxSearches: 3,
    minReads: 3,
    maxReads: 6,
    maxSteps: 18,
    maxTextChars: 4_000,
    scoreCutoff: 2,
    minArticles: 1,
    maxArticles: 3,
  },
};

// Read at import, not by injection: the search tool builds its arguments when the module loads and
// has no Nest around it, the same reason `models.ts` reads MODEL_<AGENT> from the environment.
// An unknown value is refused here; a missing one is a development machine.
export const DEPLOYMENT: Deployment = deploymentSchema.parse(process.env.ARGON_ENV ?? "local");
export const PROFILE: Profile = PROFILES[DEPLOYMENT];

// What a run actually does. Outside production the caller may ask for the other mode — the point of
// `live` in the lab. Production never runs on a fixture, whoever asks: a mocked edition would reach
// real subscribers.
export function resolveMode(deployment: Deployment, requested?: Mode): Mode {
  if (deployment === "prod") return "live";
  return requested ?? PROFILES[deployment].mode;
}
