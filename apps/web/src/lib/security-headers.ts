/*
 * Headers de segurança do site. O build estático (`output: "export"`) não aplica `headers()`
 * do next.config: quem os põe nas respostas é o CloudFront (response headers policy), e os
 * valores de lá devem ser copiados daqui (deploy/aws/site_cdn.tf). O `next dev` aplica estes
 * mesmos valores pelo next.config, para o desenvolvimento esbarrar nas mesmas regras.
 *
 * Para o lab (API em https://api.lab.argonbusiness.com), a CSP fica:
 *
 *   default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
 *   img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://api.lab.argonbusiness.com;
 *   frame-ancestors 'none'; base-uri 'self'; form-action 'self'
 *
 * (numa linha só, separada por "; " — veja `contentSecurityPolicy`).
 */

/**
 * Quase tudo é da mesma origem: next/font hospeda as fontes junto do site e nenhum script de
 * terceiro é carregado. A exceção é a API: os formulários a chamam direto do navegador, então
 * a origem dela entra no `connect-src` — sem isso o navegador bloqueia o fetch. Scripts e
 * estilos inline continuam liberados porque o próprio Next os emite (dados de hidratação, tags
 * de estilo), e o script de tema do <head> também é inline. Em desenvolvimento entra o eval,
 * para os source maps do bundler.
 */
export function contentSecurityPolicy(apiOrigin: string, { development = false } = {}): string {
  return [
    "default-src 'self'",
    development ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Os tokens de confirmação e de cancelamento viajam na URL; sem isto eles vazam no Referer de
 * qualquer link clicado a partir da página. As duas páginas também levam
 * `<meta name="referrer" content="no-referrer">`, que vale mesmo sem o header.
 */
export const REFERRER_POLICY = "no-referrer";

/** As páginas que recebem token na URL, sem prefixo de idioma (a CDN casa também com ele). */
export const TOKEN_PAGES = ["/newsletter/confirm/", "/newsletter/unsubscribe/"] as const;
