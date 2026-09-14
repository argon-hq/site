export const locales = ["pt-BR", "en-US"] as const;

export type Locale = (typeof locales)[number];

/**
 * Idioma exibido para quem chega sem preferência salva.
 * Trocar aqui muda o padrão do site inteiro.
 */
export const defaultLocale: Locale = "pt-BR";

export const LOCALE_COOKIE = "locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
