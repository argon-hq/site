import { Effect, Either } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  buildEdition,
  editionContext,
  EditionInvalidError,
  EditionNotReadyError,
  EditionRenderError,
  toEditionInput,
  validateEdition,
  type ArticleRow,
  type EditionRow,
} from "../email";
import { editionFixture } from "../email/fixtures/edition";
import type { PrismaClient } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import { UNSUBSCRIBE_PLACEHOLDER, unsubscribePlaceholderUrl } from "../subscriber/urls";
import { buildReason, loadEdition, saveBuilt } from "./build";

const date = new Date("2026-09-11T00:00:00.000Z");

const row = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  date,
  title: "Três notícias",
  subject: "Crédito, SELIC e IA",
  status: "generating",
  articles: [
    {
      canonicalUrl: "https://valor.globo.com/noticias/1",
      headline: "Manchete 1",
      body: "Corpo 1",
      category: "economy",
      score: new Prisma.Decimal(4),
      publishedAt: new Date("2026-09-11T12:00:00Z"),
    },
  ],
  ...over,
});

// Only the two calls the step makes. Enough to check what it asks the database and what it writes.
const fakePrisma = (edition: { findUnique?: unknown; update?: unknown }) => ({ edition }) as unknown as PrismaClient;

describe("loadEdition", () => {
  it("reads the day's edition with its articles", async () => {
    const findUnique = vi.fn().mockResolvedValue(row());
    const written = await Effect.runPromise(loadEdition(fakePrisma({ findUnique }), date));

    expect(findUnique.mock.calls[0]?.[0]?.where).toEqual({ date });
    expect(written.id).toBe("e1");
    expect(written.edition).toEqual({ date, title: "Três notícias", subject: "Crédito, SELIC e IA" });
    expect(written.articles).toHaveLength(1);
  });

  it("never creates: an edition the writing step has not opened is a failure", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const result = await Effect.runPromise(Effect.either(loadEdition(fakePrisma({ findUnique }), date)));

    expect(Either.isLeft(result) && result.left.reason).toContain("does not exist");
  });

  it.each(["sending", "sent"])("refuses an edition already %s", async (status) => {
    const findUnique = vi.fn().mockResolvedValue(row({ status }));
    const result = await Effect.runPromise(Effect.either(loadEdition(fakePrisma({ findUnique }), date)));

    expect(Either.isLeft(result) && result.left.reason).toContain(`already ${status}`);
  });
});

describe("saveBuilt", () => {
  it("stores both formats and moves the edition to ready", async () => {
    const update = vi.fn().mockResolvedValue({});
    await Effect.runPromise(saveBuilt(fakePrisma({ update }), { editionId: "e1", html: "<html>", text: "texto" }));

    expect(update).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { html: "<html>", text: "texto", status: "ready" },
    });
  });
});

describe("buildReason", () => {
  it("passes the reason of an edition that is not ready", () => {
    expect(buildReason(new EditionNotReadyError({ reason: "edition 2026-09-11 has no articles" }))).toBe(
      "edition 2026-09-11 has no articles",
    );
  });

  it("names the render failure as a template problem", () => {
    expect(buildReason(new EditionRenderError({ cause: new Error("boom") }))).toContain("failed to render");
  });

  it("lists every broken rule, with the article number of the ones that have it", () => {
    const reason = buildReason(
      new EditionInvalidError({
        errors: [
          { code: "script_present", message: "HTML contém <script>" },
          { code: "item_link_missing_in_text", message: "Link ausente no texto: https://x", item: 1 },
        ],
      }),
    );

    expect(reason).toContain("script_present: HTML contém <script>");
    expect(reason).toContain("item_link_missing_in_text (item 2)");
  });
});

// The step stores one HTML for everyone, so the unsubscribe link in it is a placeholder the sending
// step swaps per subscriber. It has to survive the builder and pass the same validation a real
// token would: nothing about the check is relaxed for it.
describe("unsubscribe placeholder", () => {
  const origins = { web: "https://argon.com.br", api: "https://api.argon.com.br", assets: "https://argon.com.br" };
  const settings = {
    sender: editionFixture.sender,
    privacy_policy_url: editionFixture.privacyPolicyUrl,
    social: editionFixture.social,
  };
  const edition: EditionRow = { date, title: "Três notícias", subject: "Crédito, SELIC e IA" };
  const articles: ArticleRow[] = [1, 2, 3].map((n) => ({
    canonicalUrl: `https://valor.globo.com/noticias/${n}`,
    headline: `Manchete ${n}`,
    body: `Corpo ${n}`,
    category: "economy",
    score: new Prisma.Decimal(n),
    publishedAt: new Date(`2026-09-1${n}T12:00:00Z`),
  }));

  it("validates clean and reaches both formats", async () => {
    const context = editionContext(settings, {
      assetsOrigin: origins.assets,
      unsubscribeUrl: unsubscribePlaceholderUrl(origins),
    });
    const built = await Effect.runPromise(
      toEditionInput(edition, articles, context).pipe(
        Effect.flatMap((input) => buildEdition(input).pipe(Effect.flatMap((e) => validateEdition(input, e)))),
      ),
    );

    expect(built.html).toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(built.text).toContain(UNSUBSCRIBE_PLACEHOLDER);
  });

  it("survives the URL encoding, so the sending step can find it by substring", async () => {
    const url = unsubscribePlaceholderUrl(origins);
    expect(url).toBe(`https://argon.com.br/newsletter/unsubscribe?token=${UNSUBSCRIBE_PLACEHOLDER}`);
  });
});
