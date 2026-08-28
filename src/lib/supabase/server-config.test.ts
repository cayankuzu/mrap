import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_SUPABASE_MEDIA_BUCKET,
  resolveSupabaseMediaBucket,
  resolveSupabaseServerConfig,
  SupabaseConfigurationError,
} from "@/lib/supabase/server-config";

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

  it("migration tarafından oluşturulan medya bucket değerini normalize eder", () => {
    expect(resolveSupabaseMediaBucket({ SUPABASE_MEDIA_BUCKET: "  mrap-media  " }))
      .toBe(DEFAULT_SUPABASE_MEDIA_BUCKET);
  });

  it.each([
    "mrap-media-production",
    "../mrap-media",
    "mrap/media",
    "MRAP-MEDIA",
    ".mrap-media",
    "mrap-media-",
    "a".repeat(64),
  ])("migration sözleşmesi dışındaki medya bucket değerini reddeder (%s)", (value) => {
    expect(() => resolveSupabaseMediaBucket({ SUPABASE_MEDIA_BUCKET: value }))
      .toThrow(SupabaseConfigurationError);
  });

  it.each([undefined, "", "   "])("eksik medya bucket değerinde migration varsayılanını kullanır (%s)", (value) => {
    expect(resolveSupabaseMediaBucket({ SUPABASE_MEDIA_BUCKET: value })).toBe(DEFAULT_SUPABASE_MEDIA_BUCKET);
  });
});
