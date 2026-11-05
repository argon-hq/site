import type { MastraScorers } from "@mastra/core/evals";
import { z } from "zod";

// The scorers a run attaches to its own calls: only where the Studio is served, where the scores
// are recorded and shown. Read at import, like the profile: only the one flag, parsed the way
// `loadConfig` parses it, so a test that imports the pipeline does not need the whole environment.
const studio = z.stringbool().default(false).catch(false).parse(process.env.STUDIO_ENABLED);

type LiveScorers = { write?: MastraScorers };

let loaded: LiveScorers | undefined;

export function liveScorers(): LiveScorers {
  if (!studio) return {};
  if (!loaded) {
    // A development dependency, loaded only here (studio-extras.ts).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { writeFidelity } = require("./studio-extras") as typeof import("./studio-extras");
    loaded = { write: { fidelity: { scorer: writeFidelity } } };
  }
  return loaded;
}
