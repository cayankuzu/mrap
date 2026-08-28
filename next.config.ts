import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ["@countrystatecity/countries"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    const isDevelopment = process.env.NODE_ENV !== "production";
    const contentSecurityPolicy = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDevelopment ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.openfreemap.org https://openfreemap.org https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.openfreemap.org https://openfreemap.org https://*.supabase.co wss://*.supabase.co",
      "frame-src https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      ...(!isDevelopment ? ["upgrade-insecure-requests"] : []),
    ].join("; ");
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
        ...(isDevelopment ? [] : [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ]),
      ],
    }, {
      source: "/api/:path*",
      headers: [
        { key: "Cache-Control", value: "private, no-store" },
      ],
    }];
  },
};

export default nextConfig;
