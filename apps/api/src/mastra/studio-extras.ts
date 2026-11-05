import { createHallucinationScorer } from "@mastra/evals/scorers/prebuilt";
import { getUserMessageFromRunInput } from "@mastra/evals/scorers/utils";
import { MastraStorageExporter, Observability } from "@mastra/observability";
import type { MastraModelConfig } from "@mastra/core/llm";
import { modelId } from "./models";
import { WRITE_FIDELITY_SCORER } from "./scorer-ids";

// What only a development machine's Studio carries: the traces of every run and the score of every
// written item. Both packages are development dependencies, absent from the deployed image, so this
// module is loaded with `require` only where STUDIO_ENABLED is on (index.ts, live-scorers.ts) and
// never by a Lambda. Token cost stays out of every deployed database: the traces that keep it live
// in the local one.

// The article the writing step was given: the prompt carries it between two markers (`itemPrompt`).
export function articleFromPrompt(prompt: string | undefined): string {
  if (!prompt) return "";
  const match = /--- notícia ---\n([\s\S]*?)\n--- fim ---/.exec(prompt);
  return match?.[1]?.trim() ?? "";
}

// Whether the item says anything the source did not: every claim in the answer is checked against the
// article it was written from. 0 is faithful, 1 is invented. One judge call per item, on the
// writing step's model; the same scorer runs in a local run and in the experiments over the `write`
// dataset.
export const writeFidelity = createHallucinationScorer({
  model: `anthropic/${modelId("write")}` as MastraModelConfig,
  options: { getContext: ({ run }) => [articleFromPrompt(getUserMessageFromRunInput(run.input))] },
});

if (writeFidelity.id !== WRITE_FIDELITY_SCORER) {
  throw new Error(`the fidelity scorer is ${writeFidelity.id}, and scorer-ids.ts says ${WRITE_FIDELITY_SCORER}`);
}

export const studioScorers = { writeFidelity };

export const studioObservability = () =>
  new Observability({
    configs: { default: { serviceName: "argon-api", exporters: [new MastraStorageExporter()] } },
  });
