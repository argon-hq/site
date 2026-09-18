import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { collectContext, type CollectRequestContext } from "./context";

const outputSchema = z.object({
  articles: z.array(z.object({ title: z.string(), url: z.string(), publishedAt: z.string().nullable() })),
  seenUrls: z.array(z.string()),
});

// What the newsletter already covered or already looked at, so the collector does not repeat itself.
export const recentArticles = createTool({
  id: "recent_articles",
  description: "Notícias já guardadas nos últimos dias e links já visitados. Chame uma vez antes de pesquisar.",
  inputSchema: z.object({}),
  outputSchema,
  execute: async (_input, context) => {
    const { prisma, recentDays } = collectContext(context.requestContext as CollectRequestContext | undefined);
    const from = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);
    const [articles, seen] = await Promise.all([
      prisma.article.findMany({
        where: { createdAt: { gte: from } },
        orderBy: { createdAt: "desc" },
        select: { headline: true, originalTitle: true, canonicalUrl: true, publishedAt: true },
      }),
      prisma.seenUrl.findMany({ where: { seenAt: { gte: from } }, select: { url: true } }),
    ]);
    return {
      articles: articles.map((a) => ({ title: a.headline ?? a.originalTitle, url: a.canonicalUrl, publishedAt: a.publishedAt?.toISOString() ?? null })),
      seenUrls: seen.map((s) => s.url),
    };
  },
});
