import { readCookie, writeCookie } from "@/lib/cookie";
import { THEME_COOKIE, defaultTheme, isTheme, type Theme } from "./config";

/*
 * O tema escolhido, do lado do navegador: o cookie guarda, o atributo data-theme do <html>
 * aplica. Exposto como store externa para o seletor ler com useSyncExternalStore — o valor só
 * existe no navegador, e o HTML estático sai com o padrão.
 */

const listeners = new Set<() => void>();

export function readTheme(): Theme {
  const value = readCookie(THEME_COOKIE);
  return isTheme(value) ? value : defaultTheme;
}

export function saveTheme(theme: Theme): void {
  writeCookie(THEME_COOKIE, theme);

  // Applied right away: the switch needs no reload.
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }

  for (const listener of listeners) listener();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
