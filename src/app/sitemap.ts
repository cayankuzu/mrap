import type { MetadataRoute } from "next";
import { resolvePublicOrigin } from "@/lib/public-origin";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = resolvePublicOrigin();
  return ["", "/help", "/privacy", "/terms"].map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: path ? "monthly" : "weekly",
    priority: path ? 0.5 : 1,
  }));
}
