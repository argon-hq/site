import { THEME_COOKIE, defaultTheme, themes } from "./config";

/**
 * Aplica o tema salvo antes da primeira pintura. O HTML é o mesmo para todo mundo (site
 * estático), então quem escolheu outro tema veria um flash do padrão até o React hidratar;
 * este trecho roda inline no <head>, antes do <body> existir.
 *
 * Mesma regra do seletor: cookie ausente ou inválido vale o padrão, e "system" tira o
 * atributo para o color-scheme seguir o sistema operacional.
 */
export const themeScript = `(function () {
  try {
    var match = document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=([^;]*)/);
    var theme = match ? decodeURIComponent(match[1]) : "";
    if (${JSON.stringify(themes)}.indexOf(theme) === -1) theme = ${JSON.stringify(defaultTheme)};
    var root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  } catch (error) {}
})();`;
