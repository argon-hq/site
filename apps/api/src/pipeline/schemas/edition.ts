import { z } from "zod";

export const BODY_MAX = 190;
export const SUBJECT_MAX = 78;

// Mesmos valores do enum article_category do banco, com o rótulo usado no e-mail.
export const CATEGORIES = {
  business: "Negócios",
  entrepreneurship: "Empreendedorismo",
  technology: "Tecnologia",
  economy: "Economia",
  politics: "Política",
} as const;

export const categorySchema = z.enum(Object.keys(CATEGORIES) as [keyof typeof CATEGORIES, ...Array<keyof typeof CATEGORIES>]);

// Saída do Redator para um item. O link não vem do modelo: é a URL canônica.
export const writtenItemSchema = z.object({
  category: categorySchema,
  headline: z.string().min(1).max(120),
  body: z.string().min(1).max(BODY_MAX),
});

// Saída do Redator para a edição inteira.
export const writtenEditionSchema = z.object({
  title: z.string().min(1).max(80),
  subject: z.string().min(1).max(SUBJECT_MAX),
  items: z.array(writtenItemSchema).min(1),
});

export type WrittenItem = z.infer<typeof writtenItemSchema>;
export type WrittenEdition = z.infer<typeof writtenEditionSchema>;
