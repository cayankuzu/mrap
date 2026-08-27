import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveSupabaseServerConfig, SupabaseConfigurationError } from "@/lib/supabase/server-config";

const configured = {
  MRAP_DATA_PROVIDER: "supabase",
  NEXT_PUBLIC_SUPABASE_URL: "https://kpsiqurdxumsouimjmvc.supabase.co",
  SUPABASE_URL: "https://kpsiqurdxumsouimjmvc.supabase.co/",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
  SUPABASE_SECRET_KEY: "server-secret-placeholder-supabase",
  SUPABASE_PROJECT_REF: "kpsiqurdxumsouimjmvc",
};

beforeEach(() => vi.unstubAllEnvs());

describe("Supabase typed environment", () => {
  it("yerel SQLite geliştirmeyi Supabase secret istemeden korur", () => {
    expect(resolveSupabaseServerConfig({ MRAP_DATA_PROVIDER: "sqlite" })).toEqual({ enabled: false, provider: "sqlite" });
  });

  it("eksik hosted yapılandırmayı sessiz SQLite fallback yerine reddeder", () => {
    expect(() => resolveSupabaseServerConfig({ MRAP_DATA_PROVIDER: "supabase" })).toThrow(SupabaseConfigurationError);
  });

  it("project ref, URL ve anahtar sözleşmesini normalize eder", () => {
    expect(resolveSupabaseServerConfig(configured)).toMatchObject({
      enabled: true,
      provider: "supabase",
      url: "https://kpsiqurdxumsouimjmvc.supabase.co",
      projectRef: "kpsiqurdxumsouimjmvc",
    });
  });

  it("production'da HTTPS dışını ve farklı project ref'i reddeder", () => {
    expect(() => resolveSupabaseServerConfig({ ...configured, NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://kpsiqurdxumsouimjmvc.supabase.co", SUPABASE_URL: "http://kpsiqurdxumsouimjmvc.supabase.co" })).toThrow(SupabaseConfigurationError);
    expect(() => resolveSupabaseServerConfig({ ...configured, SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst" })).toThrow(SupabaseConfigurationError);
  });
});
