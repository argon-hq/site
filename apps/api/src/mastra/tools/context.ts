import type { RequestContext } from "@mastra/core/request-context";
import { Data, Effect } from "effect";
import type { PrismaClient } from "../../generated/prisma/client";

// What the pipeline hands to the tools for one run. Tools have no Nest injection: they read this.
export type CollectContext = {
  prisma: PrismaClient;
  recentDays: number; // how far back recent_articles looks
};

export type CollectRequestContext = RequestContext<CollectContext>;

export class MissingContext extends Data.TaggedError("MissingContext")<{ tool: string }> {}

// The context is checked key by key: a run that reaches a tool without it fails here, named, and
// not later inside a query.
export const collectContext = (
  tool: string,
  requestContext: CollectRequestContext | undefined,
): Effect.Effect<CollectContext, MissingContext> => {
  const prisma = requestContext?.get("prisma");
  const recentDays = requestContext?.get("recentDays");
  return prisma && typeof recentDays === "number"
    ? Effect.succeed({ prisma, recentDays })
    : new MissingContext({ tool });
};
