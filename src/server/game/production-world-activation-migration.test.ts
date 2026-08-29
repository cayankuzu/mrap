import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608290017_activate_production_game_world.sql",
), "utf8");

describe("production oyun dünyası aktivasyonu", () => {
  it("yalnız sabit production dünyasını sözleşmesini doğruladıktan sonra açar", () => {
    expect(migration).toContain("'00000000-0000-4000-8000-000000000001'::uuid");
    expect(migration).toContain("w.slug = 'world-main'");
    expect(migration).toContain("for update");
    expect(migration).toContain("v_world.environment <> 'production'");
    expect(migration).toContain("v_world.grid_resolution <> 22");
    expect(migration).toContain("v_world.region_resolution <> 14");
    expect(migration).toContain("v_world.supported_bounds is null");
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain("competitive_claims_enabled = true");
    expect(migration).toContain("allow_simulated_location = false");
  });
});
