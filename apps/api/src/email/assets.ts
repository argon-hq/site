// The logo and the social PNGs live in apps/web/public/email. Mail clients accept neither SVG nor
// relative paths, so every image is an absolute URL, and the API has no static route of its own.
//
// Deployed environments read them from the public bucket, under their own prefix: the deploy
// workflow copies apps/web/public there before it restarts the containers (deploy/aws/README.md,
// "Arquivos públicos"), so the images an e-mail points at do not depend on the site being up nor
// on its domain. A local machine has no bucket prefix of its own and reads them from the site.

import type { Config } from "../config";

// The header carries the symbol and the drawn ARGON as two images (light on the dark band, 2x);
// the rest are the footer icons.
export const EMAIL_ICONS = ["header-symbol", "header-wordmark", "logo", "linkedin", "instagram", "youtube"] as const;

export type EmailIcon = (typeof EMAIL_ICONS)[number];

// Where they sit under the origin: apps/web/public/email, in the site and in the bucket alike.
export const EMAIL_ASSET_PATH = "email";

// The bucket deploy/aws/s3_public.tf creates; each environment writes under <env>/.
export const PUBLIC_BUCKET_URL = "https://argon-public-382597877834.s3.sa-east-1.amazonaws.com";

export function assetsOrigin({
  PUBLIC_ASSETS_ORIGIN,
  ARGON_ENV,
  WEB_ORIGIN,
}: Pick<Config, "PUBLIC_ASSETS_ORIGIN" | "ARGON_ENV" | "WEB_ORIGIN">): string {
  if (PUBLIC_ASSETS_ORIGIN) return PUBLIC_ASSETS_ORIGIN;
  if (ARGON_ENV && ARGON_ENV !== "local") return `${PUBLIC_BUCKET_URL}/${ARGON_ENV}`;
  return WEB_ORIGIN;
}

export function assetBaseUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/${EMAIL_ASSET_PATH}`;
}

export function assetUrls(origin: string): string[] {
  const base = assetBaseUrl(origin);
  return EMAIL_ICONS.map((icon) => `${base}/${icon}.png`);
}
