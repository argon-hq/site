import type { LoggerService } from "@nestjs/common";
import { Effect, Exit, Struct } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { BODY_TARGET, SUBJECT_MAX, type WrittenItem } from "../mastra/schemas/edition";
import {
  belowMinimum,
  headerPrompt,
  itemPrompt,
  ItemFailed,
  openEdition,
  saveEdition,
  fillEdition,
  hydrate,
  releaseFichas,
  selectFichas,
  withReadBudget,
  skipEdition,
  sumUsage,
  writeItem,
  type Candidate,
  type Ficha,
  type Generate,
  type ItemResult,
} from "./write";

const silent: LoggerService = { log: () => {}, warn: () => {}, error: () => {} };

const candidate: Candidate = {
  id: "a1",
  canonicalUrl: "https://valor.globo.com/empresas/noticia/x.ghtml",
  sourceName: "Valor Econômico",
  originalTitle: "Copom mantém a Selic em 12%",
  extractedText: "O Copom manteve a taxa básica de juros em 12% ao ano.",
  codeScore: 7,
  verdict: null,
  textFrom: { url: "https://valor.globo.com/empresas/noticia/x.ghtml", sourceName: "Valor Econômico", via: "page" },
};

const item: WrittenItem = {
  category: "economy",
  headline: "Copom mantém a Selic em 12%",
  body: "O Copom manteve a taxa em 12%.",
};

// Answers the given results in order, one per attempt, and records the prompts it received. A
// string stands for a rejected generation, the way Mastra reports a schema the model did not meet.
function generator(...results: Array<WrittenItem | string>): { generate: Generate<WrittenItem>; prompts: string[] } {
  const prompts: string[] = [];
  const generate: Generate<WrittenItem> = (prompt) => {
    prompts.push(prompt);
    const result = results[prompts.length - 1];
    return typeof result === "string" || result === undefined
      ? Effect.fail(new ItemFailed({ reason: String(result) }))
      : Effect.succeed({ object: result, usage: { inputTokens: 10, outputTokens: 5 } });
  };
  return { generate, prompts };
}

describe("writeItem", () => {
  it("writes the item and keeps the article id for the persistence", async () => {
    const result = await Effect.runPromise(writeItem(candidate, generator(item).generate, silent));
    expect(result).toMatchObject({ outcome: "written", id: "a1", url: candidate.canonicalUrl, item });
  });

  it("gives the second attempt the reason the first was rejected", async () => {
    const { generate, prompts } = generator("body: 290 caracteres, máximo 272", item);
    const result = await Effect.runPromise(writeItem(candidate, generate, silent));

    expect(result.outcome).toBe("written");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("290 caracteres");
  });

  it("drops the article after two attempts instead of failing the step", async () => {
    const { generate, prompts } = generator("corpo estourado", "corpo estourado de novo");
    const result = await Effect.runPromise(writeItem(candidate, generate, silent));

    expect(prompts).toHaveLength(2);
    expect(result).toEqual({ outcome: "rejected", url: candidate.canonicalUrl, reason: "corpo estourado de novo" });
  });
});

describe("writeItem's score", () => {
  it("is the model's once the triage has spoken, and the code's before", async () => {
    const before = await Effect.runPromise(writeItem(candidate, generator(item).generate, silent));
    expect(before).toMatchObject({ outcome: "written", score: 7 });
    const verdict = { id: "a1", focus: "core_business" as const, impact: 4, score: 4, reason: "r" };
    const after = await Effect.runPromise(writeItem({ ...candidate, verdict }, generator(item).generate, silent));
    expect(after).toMatchObject({ outcome: "written", score: 4 });
  });
});

describe("prompts", () => {
  it("carries the limits from the code and names the skill", () => {
    const prompt = itemPrompt(candidate);
    expect(prompt).toContain('skill "write"');
    expect(prompt).toContain(String(BODY_TARGET));
    expect(prompt).toContain("economy");
    expect(prompt).toContain(candidate.extractedText);
  });

  it("gives the header the written items in edition order", () => {
    const prompt = headerPrompt([item, { ...item, headline: "Segunda manchete" }]);
    expect(prompt).toContain(String(SUBJECT_MAX));
    expect(prompt.indexOf("Copom")).toBeLessThan(prompt.indexOf("Segunda manchete"));
  });
});

describe("openEdition", () => {
  const edition = (status: string, title: string | null = null, articles = 0) =>
    ({
      edition: { upsert: vi.fn(async () => ({ id: "e1", status, title, _count: { articles } })) },
    }) as unknown as PrismaClient;
  const day = new Date("2026-09-22T00:00:00Z");

  it("reuses the row of the day, empty", async () => {
    const result = await Effect.runPromise(openEdition(edition("generating"), day));
    expect(result).toEqual({ id: "e1", status: "generating", alreadyWritten: false });
  });

  it("reports an edition an earlier run already wrote", async () => {
    const result = await Effect.runPromise(openEdition(edition("generating", "Manhã", 4), day));
    expect(result.alreadyWritten).toBe(true);
  });

  it("does not count a title with no articles as a written edition", async () => {
    const result = await Effect.runPromise(openEdition(edition("skipped", "Manhã", 0), day));
    expect(result.alreadyWritten).toBe(false);
  });

  it("refuses to rewrite an edition already on its way out", async () => {
    const exit = await Effect.runPromiseExit(openEdition(edition("sent"), day));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("belowMinimum", () => {
  it("lets a run with enough news through", () => {
    expect(belowMinimum({ written: 3, min: 3, alreadyWritten: false })).toBe("enough");
  });

  it("skips the day when nothing was written before", () => {
    expect(belowMinimum({ written: 2, min: 3, alreadyWritten: false })).toBe("skip");
  });

  it("keeps an edition an earlier run wrote instead of downgrading it", () => {
    // A thin second run must not turn a complete edition into a `skipped` one that still carries
    // its headline and articles.
    expect(belowMinimum({ written: 1, min: 3, alreadyWritten: true })).toBe("keep_previous");
  });
});

describe("selectFichas", () => {
  it("asks for the fichas of the window, free or already in this edition, best score first, as many as told", async () => {
    const queries: Array<{ where: unknown; orderBy: unknown; take: number }> = [];
    const row = Struct.omit(candidate, "textFrom");
    const member = { url: "https://x.test/m", sourceName: "Outro", title: "Mesmo fato", textKind: "summary" };
    const findMany = vi.fn(async (args: { where: unknown; orderBy: unknown; take: number }) => {
      queries.push(args);
      return [
        { ...row, textKind: "full", groupMembers: [member] },
        { ...row, id: "a2", textKind: "none", groupMembers: "not json we wrote" },
      ];
    });
    const prisma = { article: { findMany } } as unknown as PrismaClient;
    const since = new Date("2026-09-21T08:00:00Z");

    const result = await Effect.runPromise(selectFichas(prisma, { editionId: "e1", since, take: 12 }));

    // The members column comes back parsed; one that does not parse is a ficha with no members.
    expect(result).toEqual([
      { ...row, textKind: "full", members: [member], verdict: null },
      { ...row, id: "a2", textKind: "none", members: [], verdict: null },
    ]);
    expect(queries[0]).toMatchObject({
      where: { OR: [{ editionId: null }, { editionId: "e1" }], createdAt: { gte: since }, codeScore: { not: null } },
      orderBy: [{ codeScore: "desc" }, { publishedAt: "desc" }],
      take: 12,
    });
  });
});

describe("hydrate", () => {
  const row = Struct.omit(candidate, "textFrom");
  const ficha = (over: Partial<Ficha>): Ficha => ({ ...row, textKind: "summary", members: [], ...over });
  const page = (text: string) => (url: string) =>
    Effect.succeed({ canonicalUrl: url, originalTitle: "t", extractedText: text, siteName: null, publishedAt: null });
  const closed = () => Effect.fail({ _tag: "FetchFailed", reason: "HTTP 403" });
  const members = [
    { url: "https://folha.test/a", sourceName: "Folha", title: "Mesmo fato", textKind: "summary" as const },
    { url: "https://exame.test/a", sourceName: "Exame", title: "Mesmo fato", textKind: "none" as const },
  ];

  it("writes from the feed when it carried the whole article, without reading the page", async () => {
    const read = vi.fn(page("página"));
    const result = await Effect.runPromise(hydrate(ficha({ textKind: "full", extractedText: "feed" }), read, silent));
    expect(result?.extractedText).toBe("feed");
    expect(read).not.toHaveBeenCalled();
  });

  it("reads the page when the feed had a lead or nothing", async () => {
    const result = await Effect.runPromise(hydrate(ficha({ extractedText: "lead" }), page("página inteira"), silent));
    expect(result?.extractedText).toBe("página inteira");
    expect(result?.textFrom).toEqual({ url: candidate.canonicalUrl, sourceName: "Valor Econômico", via: "page" });
  });

  it("reads the next member of the group when the representative's page is closed, and says so", async () => {
    const log = vi.fn();
    const read = vi.fn((url: string) => (url === candidate.canonicalUrl ? closed() : page("texto da Folha")(url)));
    const result = await Effect.runPromise(
      hydrate(ficha({ extractedText: "lead", members }), read, { ...silent, log }),
    );
    expect(result?.extractedText).toBe("texto da Folha");
    expect(result?.textFrom).toEqual({ url: "https://folha.test/a", sourceName: "Folha", via: "member" });
    expect(result?.canonicalUrl).toBe(candidate.canonicalUrl); // the edition still links the ficha
    expect(read.mock.calls.map(([url]) => url)).toEqual([candidate.canonicalUrl, "https://folha.test/a"]);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ msg: "text read from a member" }));
    expect(itemPrompt(result!)).toContain("Fonte: Folha");
  });

  it("tries every member before the feed's lead", async () => {
    const read = vi.fn(closed);
    const result = await Effect.runPromise(hydrate(ficha({ extractedText: "lead", members }), read, silent));
    expect(result?.extractedText).toBe("lead");
    expect(result?.textFrom.via).toBe("feed");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("stops opening pages once the run's budget is spent, and falls back to the feed", async () => {
    const pages = vi.fn(page("página"));
    const { read, spent } = await Effect.runPromise(withReadBudget(pages, 1));
    const first = await Effect.runPromise(hydrate(ficha({ extractedText: "lead 1", members }), read, silent));
    const second = await Effect.runPromise(hydrate(ficha({ extractedText: "lead 2", members }), read, silent));
    expect(first?.extractedText).toBe("página");
    expect(second?.extractedText).toBe("lead 2");
    expect(pages).toHaveBeenCalledTimes(1); // the second ficha opened nothing, members included
    expect(await Effect.runPromise(spent)).toBe(1);
  });

  it("falls back to the feed's lead when the page is closed, and leaves out a ficha with no text at all", async () => {
    const warn = vi.fn();
    const logger = { ...silent, warn };
    expect((await Effect.runPromise(hydrate(ficha({ extractedText: "lead" }), closed, logger)))?.extractedText).toBe(
      "lead",
    );
    expect(
      await Effect.runPromise(hydrate(ficha({ textKind: "none", extractedText: null }), closed, logger)),
    ).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ msg: "page read failed", fallback: "none" }));
  });
});

describe("fillEdition", () => {
  const pool = (n: number): Ficha[] =>
    Array.from({ length: n }, (_, i) => ({
      ...candidate,
      id: `f${i}`,
      canonicalUrl: `https://x.test/${i}`,
      textKind: "full",
      members: [],
    }));
  const asCandidate = (ficha: Ficha): Effect.Effect<Candidate | null> =>
    Effect.succeed({ ...ficha, extractedText: ficha.extractedText ?? "", textFrom: candidate.textFrom });
  const writes = (rejected: string[]) => {
    const asked: string[] = [];
    const write = (c: Candidate) =>
      Effect.sync(() => {
        asked.push(c.id);
        return rejected.includes(c.id)
          ? ({ outcome: "rejected", url: c.canonicalUrl, reason: "body too long" } satisfies ItemResult)
          : ({
              outcome: "written",
              id: c.id,
              url: c.canonicalUrl,
              item,
              score: c.codeScore,
              usage: null,
            } satisfies ItemResult);
      });
    return { asked, write };
  };
  const writtenIds = (items: ItemResult[]) => items.flatMap((i) => (i.outcome === "written" ? [i.id] : []));

  it("writes only as many as the edition takes when every one passes", async () => {
    const { asked, write } = writes([]);
    const { items, tried } = await Effect.runPromise(fillEdition(pool(6), 3, asCandidate, write));
    expect(writtenIds(items)).toEqual(["f0", "f1", "f2"]);
    expect(asked).toEqual(["f0", "f1", "f2"]);
    expect(tried).toBe(3);
  });

  it("puts the next ficha in the place of one rejected twice", async () => {
    const { asked, write } = writes(["f0", "f2"]);
    const { items, tried } = await Effect.runPromise(fillEdition(pool(6), 3, asCandidate, write));
    expect(writtenIds(items)).toEqual(["f1", "f3", "f4"]);
    expect(asked).toEqual(["f0", "f1", "f2", "f3", "f4"]);
    expect(tried).toBe(5);
  });

  it("skips a ficha with no text, and stops when the pool runs out", async () => {
    const { write } = writes(["f1"]);
    const noText = (ficha: Ficha) => (ficha.id === "f0" ? Effect.succeed(null) : asCandidate(ficha));
    const { items, tried } = await Effect.runPromise(fillEdition(pool(3), 3, noText, write));
    expect(writtenIds(items)).toEqual(["f2"]);
    expect(tried).toBe(3);
  });
});

describe("closing a day", () => {
  it("skips the edition and releases the fichas nobody chose, in one transaction", async () => {
    const calls: unknown[] = [];
    const record = (op: string) => vi.fn((args: unknown) => ({ op, args }));
    const prisma = {
      article: { deleteMany: record("article.deleteMany") },
      edition: { update: record("edition.update") },
      $transaction: vi.fn(async (ops: unknown[]) => calls.push(...ops)),
    } as unknown as PrismaClient;
    const now = new Date("2026-09-30T08:40:00Z");

    await Effect.runPromise(skipEdition(prisma, "e1", now));

    expect(calls).toEqual([
      { op: "article.deleteMany", args: { where: { editionId: null, createdAt: { lt: now } } } },
      { op: "edition.update", args: { where: { id: "e1" }, data: { status: "skipped" } } },
    ]);
    expect(releaseFichas).toBeTypeOf("function");
  });
});

describe("saveEdition", () => {
  it("detaches what an earlier run left and attaches what was written now", async () => {
    const calls: unknown[] = [];
    const record = (op: string) => vi.fn((args: unknown) => ({ op, args }));
    const prisma = {
      article: { updateMany: record("article.updateMany"), update: record("article.update") },
      edition: { update: record("edition.update") },
      $transaction: vi.fn(async (ops: unknown[]) => calls.push(...ops)),
    } as unknown as PrismaClient;

    await Effect.runPromise(
      saveEdition(prisma, {
        editionId: "e1",
        header: { title: "Manhã", subject: "Selic parada" },
        written: [{ id: "a1", item, score: 7 }],
      }),
    );

    expect(calls).toEqual([
      {
        op: "article.updateMany",
        args: { where: { editionId: "e1" }, data: { editionId: null, category: null, headline: null, body: null } },
      },
      {
        op: "article.update",
        args: {
          where: { id: "a1" },
          data: { editionId: "e1", category: "economy", headline: item.headline, body: item.body, score: 7 },
        },
      },
      {
        op: "edition.update",
        args: { where: { id: "e1" }, data: { title: "Manhã", subject: "Selic parada", status: "generating" } },
      },
    ]);
  });
});

describe("sumUsage", () => {
  it("adds every call of the step and ignores what is not a number", () => {
    expect(sumUsage([{ inputTokens: 10, outputTokens: 4, model: "x" }, { inputTokens: 5 }, null])).toEqual({
      inputTokens: 15,
      outputTokens: 4,
    });
  });
});
