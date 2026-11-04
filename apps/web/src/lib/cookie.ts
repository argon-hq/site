/*
 * Cookies de preferência (idioma, tema), escritos e lidos só no navegador: o site é estático
 * e nenhum servidor os lê. Na borda, o CloudFront usa o de idioma para escolher a pasta do
 * idioma — por isso eles não podem ser httpOnly.
 */

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

export function readCookie(name: string): string | undefined {
  for (const pair of document.cookie.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function writeCookie(name: string, value: string): void {
  // Secure: every environment, local dev included, serves https.
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${ONE_YEAR_IN_SECONDS}; SameSite=Lax; Secure`;
}
