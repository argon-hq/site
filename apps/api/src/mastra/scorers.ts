import type { MastraScorers } from "@mastra/core/evals";
import { createScorer } from "@mastra/core/evals";
import { createHallucinationScorer } from "@mastra/evals/scorers/prebuilt";
import { extractToolCalls, getUserMessageFromRunInput } from "@mastra/evals/scorers/utils";
import { z } from "zod";
import { PROFILE } from "../pipeline/profile";
import { modelFor } from "./models";

// Scores for the Editor's work, kept by Mastra and shown in the Studio (Scorers, and next to each
// trace). The rules are code and refuse what breaks them; these measure what no rule can — how
// thoroughly the agent looked, and whether what it wrote says only what the source said.

// How much the collection read before judging. The profile says how many pages a run should open;
// a run that judges thirty results by their headlines and reads three scores low, and the reason says
// so in numbers. Code only: no model, no cost.
export const collectRigor = createScorer({
  id: "collect-rigor",
  name: "Collect rigor",
  description: `Pages read against the profile's floor (${PROFILE.minReads}), with the searches alongside.`,
  type: "agent",
})
  .preprocess(({ run }) => {
    const { tools } = extractToolCalls(run.output);
    return {
      reads: tools.filter((name) => name === "read_page").length,
      searches: tools.filter((name) => name.includes("web_search")).length,
      floor: PROFILE.minReads,
    };
  })
  .generateScore(({ results }) => Math.min(results.preprocessStepResult.reads / results.preprocessStepResult.floor, 1))
  .generateReason(({ results }) => {
    const { reads, searches, floor } = results.preprocessStepResult;
    return `${reads} page(s) read (floor ${floor}), ${searches} search(es).`;
  });

// The article the writing step was given: the prompt carries it between two markers (`itemPrompt`).
export function articleFromPrompt(prompt: string | undefined): string {
  if (!prompt) return "";
  const match = /--- notícia ---\n([\s\S]*?)\n--- fim ---/.exec(prompt);
  return match?.[1]?.trim() ?? "";
}

// Whether the item says anything the source did not: every claim in the answer is checked against the
// article it was written from. 0 is faithful, 1 is invented. One judge call per item, on the cheap
// model; the same scorer runs in the pipeline and in the experiments over the `write` dataset.
export const writeFidelity = createHallucinationScorer({
  model: modelFor("judge"),
  options: { getContext: ({ run }) => [articleFromPrompt(getUserMessageFromRunInput(run.input))] },
});

// Registered on the instance: a score is saved under the scorer it names, and experiments pick
// scorers by id from here.
export const scorers = {
  collectRigor,
  writeFidelity,
};

// Where the pipeline scores its own calls. Only where the Studio is served — the scores carry the
// judge's cost and the architecture keeps cost out of storage, so production does not score. Each
// is attached to the working call only: the call that shapes the answer has nothing to judge.
// Read at import, like the profile: only the one flag, parsed the way `loadConfig` parses it, so a
// test that imports the pipeline does not need the whole environment.
const scoring = z.stringbool().default(false).catch(false).parse(process.env.STUDIO_ENABLED);

export const liveScorers: { collect?: MastraScorers; write?: MastraScorers } = scoring
  ? {
      collect: { rigor: { scorer: collectRigor } },
      write: { fidelity: { scorer: writeFidelity } },
    }
  : {};
