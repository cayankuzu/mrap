import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countryUpsert: vi.fn(),
  cityUpsert: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin-client", () => ({
  createMrapSupabaseAdminClient: () => ({
    from: (table: string) => ({
      upsert: table === "countries" ? mocks.countryUpsert : mocks.cityUpsert,
    }),
  }),
}));

import { ensureSupabaseLocationCatalog } from "@/lib/supabase/location-catalog";

describe("Supabase dünya konum kataloğu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countryUpsert.mockResolvedValue({ error: null });
    mocks.cityUpsert.mockResolvedValue({ error: null });
  });

  it("doğrulanmış canonical ülke/şehir çiftini FK kataloğuna yazar", async () => {
    await ensureSupabaseLocationCatalog({
      countryCode: "TR",
      country: "Türkiye",
      cityId: "csc:TR:34:153786",
      city: "İstanbul",
    });

    expect(mocks.countryUpsert).toHaveBeenCalledWith({ code: "TR", name_tr: "Türkiye", is_active: true }, { onConflict: "code" });
    expect(mocks.cityUpsert).toHaveBeenCalledWith({ id: "csc:TR:34:153786", country_code: "TR", name_tr: "İstanbul", is_active: true }, { onConflict: "id" });
  });

  it("şehir kimliğinin içindeki ülke farklıysa veritabanına dokunmaz", async () => {
    await expect(ensureSupabaseLocationCatalog({
      countryCode: "DE",
      country: "Almanya",
      cityId: "csc:TR:34:153786",
      city: "İstanbul",
    })).rejects.toThrow("geçersiz");
    expect(mocks.countryUpsert).not.toHaveBeenCalled();
    expect(mocks.cityUpsert).not.toHaveBeenCalled();
  });
});
