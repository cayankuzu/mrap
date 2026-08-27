import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, openRoute, watchBrowserFailures } from "./support";

test.skip(({ browserName }) => browserName !== "chromium", "Ağır responsive matris Chromium üzerinde çalışır.");

const viewports = [
  { name: "320-min", width: 320, height: 568 },
  { name: "360-mobile", width: 360, height: 640 },
  { name: "375-mobile", width: 375, height: 667 },
  { name: "390-mobile", width: 390, height: 844 },
  { name: "412-mobile", width: 412, height: 915 },
  { name: "480-large-mobile", width: 480, height: 800 },
  { name: "768-tablet", width: 768, height: 1024 },
  { name: "820-tablet", width: 820, height: 1180 },
  { name: "1024-small-desktop", width: 1024, height: 768 },
  { name: "1280-desktop", width: 1280, height: 800 },
  { name: "1440-desktop", width: 1440, height: 900 },
  { name: "1920-wide", width: 1920, height: 1080 },
  { name: "844-landscape", width: 844, height: 390 },
  { name: "1024-short", width: 1024, height: 520 },
] as const;

async function verifyRepresentativePages(page: Page, label: string) {
  const health = watchBrowserFailures(page);
  await openRoute(page, "/", /Adımlarınla/);
  await expectNoHorizontalOverflow(page, `${label} tanıtım`);
  await openRoute(page, "/demo/home", "Akışın");
  await expect(page.locator("article.post-card").first()).toBeVisible();
  await expectNoHorizontalOverflow(page, `${label} demo akış`);
  await openRoute(page, "/demo/play", /Stratejik rotanı başlat/);
  await expectNoHorizontalOverflow(page, `${label} oyun haritası`);
  await health.assertClean();
}

test.describe("Chromium responsive görünüm matrisi", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await verifyRepresentativePages(page, viewport.name);
    });
  }

  test("320px kısa ekranda yorum paneli görünür alana sığar", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/home", "Akışın");
    await page.locator("article.post-card").first().getByRole("button", { name: /yorumu göster/ }).click();
    const dialog = page.getByRole("dialog", { name: /Yorumlar/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Yorumun" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "320x480 yorum paneli");
    await health.assertClean();
  });

  test("200% metin ölçeğinde temel işlemler taşmaz", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const health = watchBrowserFailures(page);
    await openRoute(page, "/login", /Haritana geri dön/);
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "200% metin ölçeği giriş");
    await openRoute(page, "/demo/profile", page.locator(".profile-identity h1"));
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expectNoHorizontalOverflow(page, "200% metin ölçeği profil");
    await health.assertClean();
  });

  test("geniş ekranda sabit üst bar yenileme ve bildirim işlemlerini korur", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/home", "Akışın");
    const topbar = page.locator(".app-topbar");
    await expect(topbar).toBeVisible();
    await expect(topbar).toHaveCSS("position", "fixed");
    await expect(topbar.getByRole("link", { name: "Bildirimler" })).toBeVisible();
    const refresh = topbar.getByRole("button", { name: "Ekranı yenile" });
    await expect(refresh).toBeVisible();
    await refresh.click();
    await expect(refresh).toHaveAttribute("aria-busy", "true");
    await expect(refresh).toHaveAttribute("aria-busy", "false", { timeout: 3_000 });
    await expectNoHorizontalOverflow(page, "1440px sabit üst bar");
    await health.assertClean();
  });

  test("mobil dokunma alanları masaüstü harita kontrollerini büyütmez", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/play", /Stratejik rotanı başlat/);

    const compactControls = [
      page.getByRole("button", { name: "Konumuma dön" }),
      page.getByRole("button", { name: "Rota panelini küçült" }),
    ];
    for (const control of compactControls) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(Math.min(box?.width ?? 44, box?.height ?? 44)).toBeLessThan(44);
    }

    await page.getByRole("button", { name: /Alan \/ boya rengi/ }).click();
    const paletteArrow = await page.locator(".color-palette-pagebar > button").first().boundingBox();
    expect(paletteArrow).not.toBeNull();
    expect(paletteArrow?.width ?? 44).toBeLessThan(44);
    expect(paletteArrow?.height ?? 44).toBeLessThan(44);
    await health.assertClean();
  });
});
