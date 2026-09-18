import { createTool } from "@mastra/core/tools";
import { Data, Effect } from "effect";
import { z } from "zod";
import { collectContext, type CollectRequestContext } from "./context";

const outputSchema = z.object({
  articles: z.array(z.object({ title: z.string(), url: z.string(), publishedAt: z.string().nullable() })),
  seenUrls: z.array(z.string()),
});

class RecentArticlesFailed extends Data.TaggedError("RecentArticlesFailed")<{ reason: string }> {}

type RecentArticles = z.infer<typeof outputSchema>;

const recent = (requestContext: CollectRequestContext | undefined) =>
  Effect.gen(function* () {
    const { prisma, recentDays } = yield* collectContext("recent_articles", requestContext);
    const from = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);

    const [articles, seen] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () =>
            prisma.article.findMany({
              where: { createdAt: { gte: from } },
              orderBy: { createdAt: "desc" },
              select: { headline: true, originalTitle: true, canonicalUrl: true, publishedAt: true },
            }),
          catch: (error) => new RecentArticlesFailed({ reason: `articles: ${String(error)}` }),
        }),
        Effect.tryPromise({
          try: () => prisma.seenUrl.findMany({ where: { seenAt: { gte: from } }, select: { url: true } }),
          catch: (error) => new RecentArticlesFailed({ reason: `seen urls: ${String(error)}` }),
        }),
      ],
      { concurrency: 2 },
    );

    return {
      articles: articles.map((a) => ({
        title: a.headline ?? a.originalTitle,
        url: a.canonicalUrl,
        publishedAt: a.publishedAt?.toISOString() ?? null,
      })),
      seenUrls: seen.map((s) => s.url),
    } satisfies RecentArticles;
  });

// What the newsletter already covered or already looked at, so the collector does not repeat itself.
export const recentArticles = createTool({
  id: "recent_articles",
  description: "Notícias já guardadas nos últimos dias e links já visitados. Chame uma vez antes de pesquisar.",
  inputSchema: z.object({}),
  outputSchema,
  // Promise boundary: Mastra calls the tool, the effect runs here.
  execute: (_input, context) => Effect.runPromise(recent(context.requestContext as CollectRequestContext | undefined)),
});
