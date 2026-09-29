import { z } from "zod";

// Article extracted from a source, before any agent touches it.
export const extractedArticleSchema = z.object({
  canonicalUrl: z.string().url(),
  originalTitle: z.string().min(1),
  extractedText: z.string().min(1),
  siteName: z.string().nullable(),
  publishedAt: z.string().nullable(),
});

export type ExtractedArticle = z.infer<typeof extractedArticleSchema>;
