import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Saída standalone para o container; a raiz de rastreio é o monorepo.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
