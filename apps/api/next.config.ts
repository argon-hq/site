import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mastra e dependências ficam fora do bundle do servidor.
  serverExternalPackages: ["@mastra/*"],
};

export default nextConfig;
