// The logo and the social PNGs are served by the site, never by the API: mail clients accept
// neither SVG nor relative paths, and the API has no static route.
//
// The base comes from WEB_ORIGIN, like every other absolute URL in an e-mail, and not from a
// setting row: the web and api images are built and deployed under the same tag, so the PNG the
// HTML points at is always the one from the commit that produced the HTML. A row in the database
// pinned every environment to whatever domain was typed into it once.

export const EMAIL_ICONS = ["logo", "linkedin", "instagram", "youtube"] as const;

export type EmailIcon = (typeof EMAIL_ICONS)[number];

// Where the site serves them from: apps/web/public/email, copied into the web image.
export const EMAIL_ASSET_PATH = "email";

export function assetBaseUrl(webOrigin: string): string {
  return `${webOrigin.replace(/\/+$/, "")}/${EMAIL_ASSET_PATH}`;
}

export function assetUrls(webOrigin: string): string[] {
  const base = assetBaseUrl(webOrigin);
  return EMAIL_ICONS.map((icon) => `${base}/${icon}.png`);
}
