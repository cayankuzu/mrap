import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { assertProductionEnvironment, productionValidationRequired, ProductionEnvironmentError, type ProductionEnvironment } from "@/server/production-environment";

const valid = {
  NODE_ENV: "production",
  VERCEL: "1",
  MRAP_DATA_PROVIDER: "supabase",
  MRAP_CANONICAL_ORIGIN: "https://mrap.example",
  MRAP_TRUST_PROXY_HEADERS: "1",
  MRAP_PRODUCTION_WORLD_ID: "world-main",
  MRAP_DEVELOPMENT_WORLD_ID: "development-sandbox",
  NEXT_PUBLIC_MRAP_PRODUCTION_WORLD_ID: "world-main",
  NEXT_PUBLIC_MRAP_DEVELOPER_CONTROLS: "false",
  NEXT_PUBLIC_SUPABASE_URL: "https://kpsiqurdxumsouimjmvc.supabase.co",
  SUPABASE_URL: "https://kpsiqurdxumsouimjmvc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_12345678901234567890",
  SUPABASE_SECRET_KEY: "server-secret-placeholder-production",
  SUPABASE_PROJECT_REF: "kpsiqurdxumsouimjmvc",
  CRON_SECRET: "cron-secret-en-az-16",
  NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: "turnstile-site-key",
  CLOUDFLARE_TURNSTILE_SECRET_KEY: "turnstile-secret-key",
  MRAP_TURNSTILE_EXPECTED_HOSTNAMES: "mrap.example,www.mrap.example",
} satisfies ProductionEnvironment;

describe("merkezi üretim ortamı kapısı", () => {
  it("yalnız Vercel veya açık zorlamalı üretim sunucusunda çalışır", () => {
    expect(productionValidationRequired({ NODE_ENV: "development", VERCEL: "1" })).toBe(false);
    expect(productionValidationRequired({ NODE_ENV: "production" })).toBe(false);
    expect(productionValidationRequired({ NODE_ENV: "production", MRAP_ENFORCE_PRODUCTION_CONFIG: "1" })).toBe(true);
  });

  it("tam ve tutarlı üretim sözleşmesini kabul eder", () => {
    expect(assertProductionEnvironment(valid)).toEqual({
      enforced: true,
      origin: "https://mrap.example",
      projectRef: "kpsiqurdxumsouimjmvc",
    });
  });

  it.each([
    ["SQLite", { MRAP_DATA_PROVIDER: "sqlite" }],
    ["HTTP origin", { MRAP_CANONICAL_ORIGIN: "http://mrap.example" }],
    ["geliştirici kontrolü", { NEXT_PUBLIC_MRAP_DEVELOPER_CONTROLS: "true" }],
    ["aynı dünya", { MRAP_DEVELOPMENT_WORLD_ID: "world-main" }],
    ["kısa cron sırrı", { CRON_SECRET: "kısa" }],
    ["yanlış Turnstile hostu", { MRAP_TURNSTILE_EXPECTED_HOSTNAMES: "baska.example" }],
  ])("%s yapılandırmasını fail-fast reddeder", (_label, override) => {
    expect(() => assertProductionEnvironment({ ...valid, ...override })).toThrow(ProductionEnvironmentError);
  });
});
