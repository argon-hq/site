import type { LoggerService } from "@nestjs/common";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { collectPrompt, fixtureCollect } from "./collect-source";
import { fixtureNews } from "./fixtures/news";
import { persistCandidate, type PersistContext } from "./persist";
import { PROFILES } from "./profile";
import { windowStart } from "./rules";

const silent: LoggerService = { log: () => {}, warn: () => {}, error: () => {} };
const now = new Date("2026-09-23T08:30:00Z");

const fakePrisma = () => {
  const created: Array<{ canonicalUrl: string; extractedText: string }> = [];
  const prisma = {
    seenUrl: { upsert: vi.fn(async () => ({})) },
    article: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: { canonicalUrl: string; extractedText: string } }) => {
        created.push(data);
        return { id: String(created.length) };
      }),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, created };
};

// What a mocked run does end to end: the fixture answers, and the same persistence the agent's
// answers go through decides what is stored.
const collectInto = async (cutoff: number, maxTextChars = 12_000) => {
  const { prisma, created } = fakePrisma();
  const collected = await Effect.runPromise(fixtureCollect({ now, since: windowStart(now), cutoff, max: 6 }));
  const context: PersistContext = { prisma, since: windowStart(now), cutoff, maxTextChars, logger: silent };

  const outcomes = await Effect.runPromise(
    Effect.forEach(collected.result.candidates, (candidate) => persistCandidate(candidate, context, collected.read)),
  );
  return { outcomes, created, collected };
};

describe("the mocked collection", () => {
  it("answers without a model and without reading the web", async () => {
    const { collected } = await collectInto(2);

    expect(collected.usage).toBeNull();
    expect(collected.result.candidates).toHaveLength(fixtureNews(now).length);
    expect(collected.result.notes).toContain("mockada");
  });

  it("stores what the cutoff lets through, like any other run", async () => {
    const { outcomes, created } = await collectInto(PROFILES.local.scoreCutoff);

    expect(created.length).toBe(outcomes.filter((o) => o.outcome === "saved").length);
    expect(created.length).toBeGreaterThanOrEqual(PROFILES.local.minArticles);
  });

  it("drops what production's cutoff would drop: the filters are the real ones", async () => {
    const weak = await collectInto(5);

    expect(weak.created).toHaveLength(0);
    expect(weak.outcomes.every((o) => o.outcome === "below_cutoff")).toBe(true);
  });

  it("obeys the environment's text limit", async () => {
    const { created } = await collectInto(2, 80);

    for (const article of created) expect(article.extractedText.length).toBeLessThanOrEqual(80);
  });
});

describe("collectPrompt", () => {
  const prompt = (deployment: "prod" | "dev" | "lab" | "local") =>
    collectPrompt({ now, since: windowStart(now), cutoff: 2, max: 4, profile: PROFILES[deployment] });

  it("carries the reading budget, which is what stops a run from judging thirty results by their headlines", () => {
    expect(prompt("dev")).toContain(`Leituras: abra de ${PROFILES.dev.minReads} a ${PROFILES.dev.maxReads} páginas.`);
  });

  it("gives every environment its own limits, so the skill never has to know where it is running", () => {
    for (const env of ["prod", "dev", "lab", "local"] as const) {
      const text = prompt(env);
      expect(text).toContain(`de ${PROFILES[env].minSearches} a ${PROFILES[env].maxSearches}`);
      expect(text).toContain(`de ${PROFILES[env].minReads} a ${PROFILES[env].maxReads}`);
    }
  });

  it("names the window and the cutoff, which are the two rules the agent may not bend", () => {
    const text = prompt("dev");
    expect(text).toContain("Janela: só notícias publicadas depois de");
    expect(text).toContain("Corte: nota 2.");
  });
});
