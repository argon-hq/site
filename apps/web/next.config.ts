import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { fileURLToPath } from "node:url";

// Everything is same-origin: next/font self-hosts the fonts, the API is only
// reached from the server, and no third-party script is loaded. Inline scripts
// and styles stay allowed because Next itself emits them (hydration data,
// style tags). Development adds eval for the bundler's source maps.
const contentSecurityPolicy = [
  "default-src 'self'",
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Saída standalone para o container; a raiz de rastreio é o monorepo.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  headers() {
    return [
      {
        source: "/(.*)",
        headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }],
      },
      {
        // O token de cancelamento viaja na URL; sem isto ele vaza no Referer de
        // qualquer link que a pessoa clicar a partir da página.
        source: "/newsletter/unsubscribe",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        // Mesmo motivo: o token de confirmação viaja na URL.
        source: "/newsletter/confirm",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
