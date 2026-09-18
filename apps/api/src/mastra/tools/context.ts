import type { RequestContext } from "@mastra/core/request-context";
import type { PrismaClient } from "../../generated/prisma/client";

// What the pipeline hands to the tools for one run. Tools have no Nest injection: they read this.
export type CollectContext = {
  prisma: PrismaClient;
  recentDays: number; // how far back recent_articles looks
};

export type CollectRequestContext = RequestContext<CollectContext>;

export function collectContext(requestContext: CollectRequestContext | undefined): CollectContext {
  if (!requestContext) throw new Error("collect tools need the pipeline request context");
  return { prisma: requestContext.get("prisma"), recentDays: requestContext.get("recentDays") };
}
