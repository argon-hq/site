import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

// Written once, at build: the site is static, and each environment has its own
// build, with its WEB_ORIGIN. The URLs carry no locale prefix — the CDN picks
// the locale folder by cookie, and the default one without it.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();

  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/newsletter`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
