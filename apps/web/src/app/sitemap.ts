import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

// Rendered per request, not at build: the origin comes from the runtime
// environment, and the same image serves dev, lab and prod.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();

  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/newsletter`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
