import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, openRoute, watchBrowserFailures } from "./support";

test.skip(({ browserName }) => browserName !== "chromium", "Sıralama etkileşim sözleşmesi Chromium üzerinde doğrulanır.");

test("demo sıralaması ortak kapsam, arama ve çoklu konum filtrelerini kullanır", async ({ page }) => {
  const health = watchBrowserFailures(page);
  await openRoute(page, "/demo/leaderboard", "Sıralama");

  const scopeGroup = page.getByRole("group", { name: "Sıralama kapsamı" });
  const scopes = scopeGroup.getByRole("button");
  const friendsScope = page.getByRole("button", { name: "Arkadaşlar", exact: true });
  const cityScope = page.getByRole("button", { name: "Şehir", exact: true });
  const countryScope = page.getByRole("button", { name: "Ülke", exact: true });
  const worldScope = page.getByRole("button", { name: "Dünya", exact: true });
  const renderedPlayers = page.locator(".podium-place, .real-rank-list article");

  await expect(scopes).toHaveCount(4);
  await expect(scopes).toHaveText(["Arkadaşlar", "Şehir", "Ülke", "Dünya"]);
  await expect(scopeGroup.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expect(cityScope).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Mahalle", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Dönem", { exact: true })).toHaveCount(0);
  await expect(page.locator(".leaderboard-period")).toHaveCount(0);

  const search = page.getByRole("searchbox", { name: "Sıralamada ara" });
  await expect(search).toHaveAttribute("maxlength", "40");
  await search.fill("CAYAN");
  await expect(page.locator(".real-rank-list article")).toHaveCount(1);
  await expect(page.locator(".real-rank-list article")).toContainText("Cayan");
  await search.fill("");

  // Varsayılan şehir yalnız İstanbul oyuncularını içerir. Arama temizlenince
  // podyum ve liste birlikte gerçek kapsam sonucunu oluşturur.
  await expect(renderedPlayers).toHaveCount(3);

  const cityPicker = page.locator(".leaderboard-multiselect");
  await cityPicker.locator("summary").click();
  const cityPanel = cityPicker.locator(".leaderboard-multiselect-panel");
  await cityPanel.getByRole("checkbox", { name: /Ankara/ }).check();
  await expect(cityPicker.locator("summary")).toContainText("2 şehir");
  await expect(cityPanel.getByRole("checkbox", { name: /İstanbul/ })).toBeChecked();
  await expect(cityPanel.getByRole("checkbox", { name: /Ankara/ })).toBeChecked();
  await cityPicker.locator("summary").click();
  await expect(renderedPlayers).toHaveCount(5);
  await expect(page.locator(".leaderboard-view")).toContainText("@ecewrap");
  await expect(page.locator(".leaderboard-view")).toContainText("@borad");

  await countryScope.click();
  await expect(countryScope).toHaveAttribute("aria-pressed", "true");
  await expect(renderedPlayers).toHaveCount(8);
  const countryPicker = page.locator(".leaderboard-multiselect");
  await countryPicker.locator("summary").click();
  const countryPanel = countryPicker.locator(".leaderboard-multiselect-panel");
  await countryPanel.getByRole("checkbox", { name: "Almanya", exact: true }).check();
  await expect(countryPicker.locator("summary")).toContainText("2 ülke");
  await expect(countryPanel.getByRole("checkbox", { name: "Türkiye", exact: true })).toBeChecked();
  await expect(countryPanel.getByRole("checkbox", { name: "Almanya", exact: true })).toBeChecked();
  await countryPicker.locator("summary").click();
  await expect(renderedPlayers).toHaveCount(10);
  await expect(page.locator(".leaderboard-view")).toContainText("@emiruns");
  await expect(page.locator(".leaderboard-view")).not.toContainText("@zeyneps");

  await search.fill("Berlin");
  await expect(page.locator(".real-rank-list article")).toHaveCount(1);
  await expect(page.locator(".real-rank-list article")).toContainText("Alp Duran");
  await search.fill("");

  await friendsScope.click();
  await expect(friendsScope).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".leaderboard-multiselect")).toHaveCount(0);
  await expect(renderedPlayers).toHaveCount(6);
  await expect(page.locator(".real-rank-list article.is-you")).toHaveCount(1);

  await worldScope.click();
  await expect(worldScope).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".leaderboard-multiselect")).toHaveCount(0);
  await expect(renderedPlayers).toHaveCount(14);
  await health.assertClean();
});

test("sıralama 320 pikselden masaüstüne taşmadan uyarlanır", async ({ page }) => {
  const health = watchBrowserFailures(page);
  for (const viewport of [{ width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await openRoute(page, "/demo/leaderboard", "Sıralama");
    await expectNoHorizontalOverflow(page, `${viewport.width}px sıralama`);
    const scopes = page.getByRole("group", { name: "Sıralama kapsamı" }).getByRole("button");
    await expect(scopes).toHaveCount(4);
    const headingDescription = await page.locator(".leaderboard-heading p").boundingBox();
    const crown = await page.locator(".podium-crown").boundingBox();
    expect(headingDescription).not.toBeNull();
    expect(crown).not.toBeNull();
    expect(crown!.y).toBeGreaterThanOrEqual(headingDescription!.y + headingDescription!.height + 8);
    if (viewport.width === 320) {
      for (const scope of await scopes.all()) {
        const box = await scope.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      }

      const picker = page.locator(".leaderboard-multiselect");
      await picker.locator("summary").click();
      const panel = picker.locator(".leaderboard-multiselect-panel");
      await expect(panel).toBeVisible();
      await expectNoHorizontalOverflow(page, "320px açık şehir seçimi");
      for (const target of [panel.getByRole("button", { name: "Tümünü seç" }), panel.locator("label").first()]) {
        const box = await target.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      }
    }
  }
  await health.assertClean();
});

test("oyun haritasında şehir bilgi kartı yoktur, konuma dön kontrolü kalır", async ({ page }) => {
  const health = watchBrowserFailures(page);
  await openRoute(page, "/demo/play", /Stratejik rotanı başlat/);
  await expect(page.locator(".map-topbar, .map-location-title")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Konumuma dön" })).toBeVisible();
  await health.assertClean();
});
