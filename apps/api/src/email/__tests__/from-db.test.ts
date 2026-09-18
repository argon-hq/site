import { describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/client";
import { buildEdition } from "../edition/build";
import { editionContext, editionDay, EditionNotReadyError, toEditionInput, type ArticleRow, type EditionContext, type EditionRow } from "../edition/from-db";
import { editionFixture } from "../fixtures/edition";
import { validateEdition } from "../validate";

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

describe("editionContext", () => {
  it("maps the identity settings and keeps the unsubscribe URL per recipient", () => {
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
    const input = toEditionInput(edition, [article(1)], context);
    expect(validateEdition(input, buildEdition(input))).toEqual([]);
  });
});

describe("toEditionInput", () => {
  it("maps the rows and the result validates clean", () => {
    const input = toEditionInput(edition, [article(1), article(2), article(3)], ctx);
    expect(input.title).toBe(edition.title);
    expect(input.subject).toBe(edition.subject);
    expect(input.items[0]).toEqual({ category: "Economia", headline: "Manchete 3", body: "Corpo 3", url: "https://example.com/noticias/3" });
    expect(input.unsubscribeUrl).toBe(ctx.unsubscribeUrl);
    expect(validateEdition(input, buildEdition(input))).toEqual([]);
  });

  it("orders by score, then newest, then URL", () => {
    const rows = [
      article(1, { score: new Prisma.Decimal("4.50"), publishedAt: new Date("2026-09-10T00:00:00Z") }),
      article(2, { score: new Prisma.Decimal("4.50"), publishedAt: new Date("2026-09-11T00:00:00Z") }),
      article(3, { score: new Prisma.Decimal("3.00") }),
      article(4, { score: new Prisma.Decimal("4.50"), publishedAt: new Date("2026-09-11T00:00:00Z") }),
    ];
    const urls = toEditionInput(edition, rows, ctx).items.map((i) => i.url.slice(-1));
    expect(urls).toEqual(["2", "4", "1", "3"]);
  });

  it("keeps the calendar day of a DATE column when formatted in São Paulo", () => {
    expect(editionDay(new Date("2026-09-11T00:00:00.000Z")).toISOString()).toBe("2026-09-11T12:00:00.000Z");
    const { text } = buildEdition(toEditionInput(edition, [article(1)], ctx));
    expect(text).toContain("Sexta-feira, 11 set 2026");
  });

  it("refuses an edition or article the writer has not filled", () => {
    expect(() => toEditionInput({ ...edition, subject: null }, [article(1)], ctx)).toThrow(EditionNotReadyError);
    expect(() => toEditionInput(edition, [], ctx)).toThrow(/no articles/);
    expect(() => toEditionInput(edition, [article(1, { body: null })], ctx)).toThrow(/noticias\/1 is not written/);
  });
});
