import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/client";
import { buildEdition } from "../edition/build";
import { editionContext, editionDay, toEditionInput, type ArticleRow, type EditionContext, type EditionRow } from "../edition/from-db";
import { EditionNotReadyError } from "../errors";
import { editionFixture } from "../fixtures/edition";
import { collectEditionErrors } from "../validate";

const { sender, unsubscribeUrl, privacyPolicyUrl, assetBaseUrl, social } = editionFixture;
const ctx: EditionContext = { sender, unsubscribeUrl, privacyPolicyUrl, assetBaseUrl, social };

const edition: EditionRow = { date: new Date("2026-09-11T00:00:00.000Z"), title: "Três notícias", subject: "Crédito, SELIC e IA" };

const article = (n: number, over: Partial<ArticleRow> = {}): ArticleRow => ({
  canonicalUrl: `https://example.com/noticias/${n}`,
  headline: `Manchete ${n}`,
  body: `Corpo ${n}`,
  category: "economy",
  score: new Prisma.Decimal(n),
  publishedAt: new Date(`2026-09-1${n}T12:00:00Z`),
  ...over,
});

// The rows go all the way through the builder, so a mapping mistake shows up as a validation error.
const buildFromRows = (rows: ArticleRow[], row: EditionRow = edition) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const input = yield* toEditionInput(row, rows, ctx);
      const built = yield* buildEdition(input);
      const errors = yield* collectEditionErrors(input, built);
      return { input, built, errors };
    }),
  );

const failureOf = (row: EditionRow, rows: ArticleRow[]) =>
  Effect.runPromise(Effect.either(toEditionInput(row, rows, ctx)));

describe("editionContext", () => {
  it("maps the identity settings and keeps the unsubscribe URL per recipient", async () => {
    const settings = {
      sender: { name: "Argon", address: "news@example.com", postalAddress: "Passo Fundo, RS" },
      privacy_policy_url: "https://example.com/privacy",
      asset_base_url: "https://example.com/email",
      social: { site: "https://example.com" },
    };
    const context = editionContext(settings, "https://example.com/unsubscribe?token=abc");

    expect(context).toEqual({
      sender: settings.sender,
      social: settings.social,
      privacyPolicyUrl: "https://example.com/privacy",
      assetBaseUrl: "https://example.com/email",
      unsubscribeUrl: "https://example.com/unsubscribe?token=abc",
    });
  });
});

describe("toEditionInput", () => {
  it("maps the rows and the result validates clean", async () => {
    const { input, errors } = await buildFromRows([article(1), article(2), article(3)]);

    expect(input.title).toBe(edition.title);
    expect(input.subject).toBe(edition.subject);
    expect(input.items[0]).toEqual({ category: "Economia", headline: "Manchete 3", body: "Corpo 3", url: "https://example.com/noticias/3" });
    expect(input.unsubscribeUrl).toBe(ctx.unsubscribeUrl);
    expect(errors).toEqual([]);
  });

  it("orders by score, then newest, then URL", async () => {
    const rows = [
      article(1, { score: new Prisma.Decimal("4.50"), publishedAt: new Date("2026-09-10T00:00:00Z") }),
      article(2, { score: new Prisma.Decimal("4.50"), publishedAt: new Date("2026-09-11T00:00:00Z") }),
      article(3, { score: new Prisma.Decimal("3.00") }),
      article(4, { score: new Prisma.Decimal("4.50"), publishedAt: new Date("2026-09-11T00:00:00Z") }),
    ];
    const { input } = await buildFromRows(rows);

    expect(input.items.map((item) => item.url.slice(-1))).toEqual(["2", "4", "1", "3"]);
  });

  it("keeps the calendar day of a DATE column when formatted in São Paulo", async () => {
    expect(editionDay(new Date("2026-09-11T00:00:00.000Z")).toISOString()).toBe("2026-09-11T12:00:00.000Z");
    const { built } = await buildFromRows([article(1)]);
    expect(built.text).toContain("Sexta-feira, 11 set 2026");
  });

  it("refuses an edition the writer has not filled", async () => {
    const result = await failureOf({ ...edition, subject: null }, [article(1)]);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(EditionNotReadyError);
      expect(result.left.reason).toMatch(/has no title or subject/);
    }
  });

  it("refuses an edition without articles", async () => {
    const result = await failureOf(edition, []);
    expect(Either.isLeft(result) && result.left.reason).toMatch(/no articles/);
  });

  it("refuses an article the writer has not filled", async () => {
    const result = await failureOf(edition, [article(1, { body: null })]);
    expect(Either.isLeft(result) && result.left.reason).toMatch(/noticias\/1 is not written/);
  });
});
