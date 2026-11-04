/**
 * Public origin of the site, for the absolute URLs in metadata (Open Graph,
 * sitemap, robots). Read at build time: the site is static, so every
 * environment has its own build.
 */
export function siteOrigin(): string {
  return process.env.WEB_ORIGIN ?? "https://argonbusiness.com";
}
