import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { PRODUCT_NAME } from "@/lib/app-config";

function runtimeSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSourceFiles(path);
    if (![".ts", ".tsx"].includes(extname(entry.name)) || entry.name.includes(".test.")) return [];
    return [path];
  });
}

describe("marka ve Türkçe kullanıcı yüzeyi", () => {
  it("çalışma zamanı kaynaklarında eski ürün adını barındırmaz", () => {
    const obsoleteBrandReferences = runtimeSourceFiles(join(process.cwd(), "src"))
      .filter((path) => /map\s*wrap/i.test(readFileSync(path, "utf8")));

    expect(obsoleteBrandReferences).toEqual([]);
  });

  it("uygulama manifestinde mrap adını ve Türkçe dili kullanır", () => {
    const appManifest = manifest();
    expect(PRODUCT_NAME).toBe("mrap");
    expect(appManifest.name).toBe("mrap — Şehri adımlarınla sar");
    expect(appManifest.short_name).toBe(PRODUCT_NAME);
    expect(appManifest.lang).toBe("tr");
  });

  it("denetlenen kullanıcı metinlerinde bulunan yabancı ifadeleri geri getirmez", () => {
    const auditedSurface = [
      "src/components/GameMap.tsx",
      "src/components/DemoProfileProvider.tsx",
      "src/app/privacy/page.tsx",
      "src/app/terms/page.tsx",
      "src/lib/territory/territory-engine.ts",
      "src/lib/spatial/ownership-grid.ts",
    ].map((path) => readFileSync(join(process.cwd(), path), "utf8")).join("\n");

    expect(auditedSurface).not.toMatch(/Sandbox ağ testi|Unicode harf|Supabase Auth|uzak migration|\bRLS\b|Territory union failed|Territory difference failed/);
    expect(auditedSurface).not.toContain("rota segmenti");
  });
});
