import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/help", "/privacy", "/terms"],
      disallow: [
        "/api/",
        "/demo/",
        "/home",
        "/explore",
        "/play",
        "/leaderboard",
        "/notifications",
        "/posts",
        "/profile",
        "/settings",
        "/users/",
        "/login",
        "/register",
        "/forgot-password",
      ],
    },
    sitemap: "/sitemap.xml",
  };
}
