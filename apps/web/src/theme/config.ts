export const themes = ["system", "light", "dark"] as const;

export type Theme = (typeof themes)[number];

/**
 * Tema de quem chega sem preferência salva: claro, independente do sistema
 * operacional. "system" continua disponível como escolha no seletor.
 */
export const defaultTheme: Theme = "light";

export const THEME_COOKIE = "theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (themes as readonly string[]).includes(value);
}
