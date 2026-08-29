import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../../../next.config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Cloudflare istemci ve HTTP sınırları", () => {
  it("istemci Turnstile bileşenine server secret değişkeni taşımaz", () => {
    const clientSource = readFileSync(resolve(process.cwd(), "src/features/security/turnstile/TurnstileChallenge.tsx"), "utf8");
    expect(clientSource).not.toContain("CLOUDFLARE_TURNSTILE_SECRET_KEY");
    expect(clientSource).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(clientSource).toContain('language: "tr"');
  });

  it("CSP Turnstile'ı dar origin ile açar, harita ve konum politikasını korur", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const headerRules = await nextConfig.headers?.();
    const globalHeaders = headerRules?.find((rule) => rule.source === "/(.*)")?.headers ?? [];
    const csp = globalHeaders.find((header) => header.key === "Content-Security-Policy")?.value ?? "";

    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("connect-src 'self' https://*.openfreemap.org https://openfreemap.org");
    expect(csp).not.toContain("script-src *");
    expect(csp).not.toContain("unsafe-eval");
    const permissionsPolicy = globalHeaders.find((header) => header.key === "Permissions-Policy")?.value ?? "";
    expect(permissionsPolicy).toContain("geolocation=(self)");
    expect(permissionsPolicy).toContain("accelerometer=(self)");
    expect(permissionsPolicy).toContain("gyroscope=(self)");
    expect(permissionsPolicy).toContain("magnetometer=(self)");
    expect(globalHeaders.find((header) => header.key === "Strict-Transport-Security")?.value).toContain("includeSubDomains");
  });

  it("API cevaplarını public edge cache'e açmaz", async () => {
    const headerRules = await nextConfig.headers?.();
    const apiHeaders = headerRules?.find((rule) => rule.source === "/api/:path*")?.headers ?? [];
    expect(apiHeaders).toContainEqual({ key: "Cache-Control", value: "private, no-store" });
  });
});
