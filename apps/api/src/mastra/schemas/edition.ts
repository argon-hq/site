import { z } from "zod";

// The body the model is asked for, and the most the code accepts: twelve characters of slack, so a
// paragraph a word over the target is not thrown away with its two attempts. The e-mail, the
// validation and the database all hold the hard limit. Under the minimum the item says too little
// to be worth a place in the edition; the database holds that one too.
export const BODY_MIN = 100;
export const BODY_TARGET = 260;
export const BODY_MAX = BODY_TARGET + 12;
// The same target in words, which is what the model can count: asked only for characters, it
// writes some forty-five words and overshoots the ceiling on the first attempt.
export const BODY_WORDS = 35;
export const HEADLINE_MAX = 120;
export const TITLE_MAX = 80;
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
const clean = (max: number, min = 1) =>
  z
    .string()
    .transform((s) =>
      s
        .replace(/[\u200b-\u200d\ufeff]/g, "")
        .replace(/\p{Cc}/gu, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .pipe(z.string().min(min).max(max));

// Writer output for one item. The link never comes from the model: it is the canonical URL.
export const writtenItemSchema = z.object({
  category: categorySchema,
  headline: clean(HEADLINE_MAX),
  body: clean(BODY_MAX, BODY_MIN),
});

// Writer output for the edition header. The items are written one at a time, so the header is a
// generation of its own, over the headlines that were approved.
export const editionHeaderSchema = z.object({
  title: clean(TITLE_MAX),
  subject: clean(SUBJECT_MAX),
});

export type WrittenItem = z.infer<typeof writtenItemSchema>;
export type EditionHeader = z.infer<typeof editionHeaderSchema>;
