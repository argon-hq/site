import { z } from "zod";

export const BODY_MAX = 190;
export const SUBJECT_MAX = 78;

// Same values as the article_category enum in the database, with the label used in the e-mail.
export const CATEGORIES = {
  business: "Negócios",
  entrepreneurship: "Empreendedorismo",
  technology: "Tecnologia",
  economy: "Economia",
  politics: "Política",
} as const;

export const categorySchema = z.enum(
  Object.keys(CATEGORIES) as [keyof typeof CATEGORIES, ...Array<keyof typeof CATEGORIES>],
);

// Models sometimes append zero-width characters; strip them before measuring length. Control
// characters, line breaks included, become a space: every field here is one line — the subject
// and the headline end up in e-mail headers, and the body is one paragraph — and the mail
// transports must never receive a break they did not put there.
const clean = (max: number) =>
  z
    .string()
    .transform((s) =>
      s
        .replace(/[\u200b-\u200d\ufeff]/g, "")
        .replace(/\p{Cc}/gu, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .pipe(z.string().min(1).max(max));

// Writer output for one item. The link never comes from the model: it is the canonical URL.
export const writtenItemSchema = z.object({
  category: categorySchema,
  headline: clean(120),
  body: clean(BODY_MAX),
});

// Writer output for the edition header. The items are written one at a time, so the header is a
// generation of its own, over the headlines that were approved.
export const editionHeaderSchema = z.object({
  title: clean(80),
  subject: clean(SUBJECT_MAX),
});

export type WrittenItem = z.infer<typeof writtenItemSchema>;
export type EditionHeader = z.infer<typeof editionHeaderSchema>;
