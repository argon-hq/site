// The ids of the scorers the Studio registers (scorers.ts), apart from them: the scorers load
// @mastra/evals, a development dependency that the deployed image does not carry, and the code that
// only names a scorer — the write dataset — must not load it.
export const WRITE_FIDELITY_SCORER = "hallucination-scorer";
