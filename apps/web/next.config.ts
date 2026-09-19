import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Saída standalone para o container; a raiz de rastreio é o monorepo.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  headers() {
    return [
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
