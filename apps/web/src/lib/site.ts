/**
 * Public origin of the site, for the absolute URLs in metadata (Open Graph,
 * sitemap, robots). Comes from the environment at request time: the container
 * image is the same for every environment.
 */
export function siteOrigin(): string {
  return process.env.WEB_ORIGIN ?? "https://argon.eduardofockink.com";
}
