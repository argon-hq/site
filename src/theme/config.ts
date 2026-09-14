export const themes = ["system", "light", "dark"] as const;

export type Theme = (typeof themes)[number];

/** "system" segue o prefers-color-scheme do sistema operacional. */
export const defaultTheme: Theme = "system";

export const THEME_COOKIE = "theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (themes as readonly string[]).includes(value);
}
