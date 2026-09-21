import { z } from "zod";

// What the Editor answers at the end of the collection step. The database is the source of truth
// for what was saved; this is the agent's own account of the run.
export const candidateSchema = z.object({
  url: z.url(),
  sourceName: z.string().min(1),
  title: z.string().min(1),
  score: z.number().min(0).max(5),
  rationale: z.string().min(1).max(400),
});

export const collectResultSchema = z.object({
  candidates: z.array(candidateSchema).describe("Notícias avaliadas, da nota maior para a menor"),
  discarded: z.number().int().min(0).describe("Resultados descartados sem leitura"),
  notes: z.string().max(600).optional().describe("Fontes que falharam ou observações"),
});

export type Candidate = z.infer<typeof candidateSchema>;
export type CollectResult = z.infer<typeof collectResultSchema>;
