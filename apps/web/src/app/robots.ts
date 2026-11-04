import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

// Same reason as the sitemap: written at build, with that environment's origin.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Destinations of e-mail links, some with a token in the URL.
      disallow: ["/newsletter/confirm", "/newsletter/confirmed", "/newsletter/unsubscribe"],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
