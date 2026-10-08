import { z } from "zod";

// What the `select` skill answers, one verdict per ficha. The classes are the newsletter's focus
// (src/ingest/triage.ts shares them with the code's own triage): business and technology are the
// core, the market only next to a named business effect, everything else is out.
export const FOCUS = ["core_business", "core_technology", "market_with_business_effect", "out"] as const;
export const focusSchema = z.enum(FOCUS);
export type Focus = z.infer<typeof focusSchema>;

// The scale of the selection, as the architecture decided: 0 to 5, the same the edition is ordered
// by.
export const SCORE_MAX = 5;
const scoreSchema = z.number().int().min(0).max(SCORE_MAX);

export const verdictSchema = z.object({
  id: z.string().min(1),
  focus: focusSchema,
  impact: scoreSchema,
  score: scoreSchema,
  reason: z.string().trim().min(1).max(300),
  // The id of the stronger ficha, or the published headline, that tells the same story.
  sameAs: z.string().trim().min(1).max(300).optional(),
});
export type Verdict = z.infer<typeof verdictSchema>;

export const triageAnswerSchema = z.object({ fichas: z.array(verdictSchema).min(1) }).describe("the triage");
export type TriageAnswer = z.infer<typeof triageAnswerSchema>;
