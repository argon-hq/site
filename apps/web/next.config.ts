import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { LOCALE_COOKIE, defaultLocale, locales } from "./src/i18n/config";
import { apiOrigin } from "./src/lib/api";
import { REFERRER_POLICY, TOKEN_PAGES, contentSecurityPolicy } from "./src/lib/security-headers";

// Site estático, para o S3 + CloudFront: `next build` grava tudo em out/. O `next dev` roda sem
// export: com ele, o dev server recusa as páginas que chegam pelas rewrites de idioma abaixo. O
// build continua sendo quem garante que tudo exporta.
const development = process.env.NODE_ENV === "development";
const output = development ? undefined : "export";

// Uma pasta por idioma (/pt-BR/, /en-US/) e links sem prefixo: no site publicado, o
// CloudFront reescreve a URL para a pasta do cookie de idioma. No `next dev` não há CloudFront,
// e estas regras fazem o mesmo papel.
const unprefixed = `/:path((?!(?:${locales.join("|")})(?:/|$)).*)`;
const localeRewrites = [
  ...locales
    .filter((locale) => locale !== defaultLocale)
    .map((locale) => ({
      source: unprefixed,
      has: [{ type: "cookie" as const, key: LOCALE_COOKIE, value: locale }],
      destination: `/${locale}/:path`,
    })),
  { source: unprefixed, destination: `/${defaultLocale}/:path` },
];

const nextConfig: NextConfig = {
  output,
  // O deploy passa um id tirado do código do site (deploy/site-sync.py): sem mudança no site, o
  // build sai igual e nenhum arquivo sobe de novo. Sem a variável, o Next sorteia um id por build.
  ...(process.env.NEXT_BUILD_ID ? { generateBuildId: async () => process.env.NEXT_BUILD_ID! } : {}),
  // Cada página vira <pasta>/index.html, que o S3 serve sem regra extra.
  trailingSlash: true,
  // O build estático ignora rewrites e headers (o Next só avisaria): lá quem faz isso é o
  // CloudFront, com os valores de src/lib/security-headers.ts.
  ...(output === "export"
    ? {}
    : {
        rewrites: async () => localeRewrites,
        headers: async () => [
          {
            source: "/(.*)",
            headers: [
              {
                key: "Content-Security-Policy",
                value: contentSecurityPolicy(apiOrigin(), { development }),
              },
            ],
          },
          ...TOKEN_PAGES.map((page) => ({
            source: page,
            headers: [{ key: "Referrer-Policy", value: REFERRER_POLICY }],
          })),
        ],
      }),
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
