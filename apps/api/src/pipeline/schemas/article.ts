import { z } from "zod";

// Notícia extraída de uma fonte, antes de qualquer agente.
export const extractedArticleSchema = z.object({
  canonicalUrl: z.string().url(),
  originalTitle: z.string().min(1),
  extractedText: z.string().min(1),
  siteName: z.string().nullable(),
  publishedAt: z.string().nullable(),
});

export type ExtractedArticle = z.infer<typeof extractedArticleSchema>;
