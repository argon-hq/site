import { createTool } from "@mastra/core/tools";
import { Data, Effect } from "effect";
import { z } from "zod";
import { collectContext, type CollectRequestContext } from "./context";

const outputSchema = z.object({
  articles: z.array(z.object({ title: z.string(), url: z.string(), publishedAt: z.string().nullable() })),
});

class RecentArticlesFailed extends Data.TaggedError("RecentArticlesFailed")<{ reason: string }> {}

type RecentArticles = z.infer<typeof outputSchema>;

const recent = (requestContext: CollectRequestContext | undefined) =>
  Effect.gen(function* () {
    const { prisma, recentDays } = yield* collectContext("recent_articles", requestContext);
    const from = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);

    const articles = yield* Effect.tryPromise({
      try: () =>
        prisma.article.findMany({
          where: { createdAt: { gte: from } },
          orderBy: { createdAt: "desc" },
          select: { headline: true, originalTitle: true, canonicalUrl: true, publishedAt: true },
        }),
      catch: (error) => new RecentArticlesFailed({ reason: `articles: ${String(error)}` }),
    });

    return {
      articles: articles.map((a) => ({
        title: a.headline ?? a.originalTitle,
        url: a.canonicalUrl,
        publishedAt: a.publishedAt?.toISOString() ?? null,
      })),
    } satisfies RecentArticles;
  });

// What the newsletter already covered, so the collector does not repeat itself. The links it only
// looked at are kept as hashes now (seen_url), which say nothing to the agent; the persistence
// still skips them.
export const recentArticles = createTool({
  id: "recent_articles",
  description: "Notícias já guardadas nos últimos dias. Chame uma vez antes de pesquisar.",
  inputSchema: z.object({}),
  outputSchema,
  // Promise boundary: Mastra calls the tool, the effect runs here.
  execute: (_input, context) => Effect.runPromise(recent(context.requestContext as CollectRequestContext | undefined)),
});
