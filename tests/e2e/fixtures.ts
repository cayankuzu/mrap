import { test as base, expect } from "@playwright/test";

const testMapStyle = {
  version: 8 as const,
  name: "mrap tarayıcı testi",
  sources: {},
  layers: [{ id: "zemin", type: "background" as const, paint: { "background-color": "#eef1e8" } }],
};

export const test = base.extend({
  page: async ({ page }, run) => {
    // E2E testleri üçüncü taraf harita ağından bağımsız ve tekrarlanabilir olmalı.
    // Gerçek OpenFreeMap entegrasyonu ayrı production smoke/Lighthouse koşusunda ölçülür.
    await page.route("https://tiles.openfreemap.org/styles/positron**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(testMapStyle) });
    });
    await run(page);
  },
});

export { expect };
