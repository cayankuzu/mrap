import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openRoute } from "./support";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  colorScheme: "light",
  userAgent: "Mozilla/5.0 (Linux; Android 15; mrap-visual-release) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
});

test.skip(({ browserName }) => browserName !== "chromium", "Piksel tabanlı sürüm kanıtı tek Chromium mobil profilinde tutulur.");

async function stabilize(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
      .maplibregl-control-container { visibility: hidden !important; }
      /* Canvas pixels are network/GPU output, not product-layout evidence. Hiding
         the bitmap in-place keeps overlays, cards and dialogs visible above it. */
      .maplibregl-canvas { visibility: hidden !important; }
      .maplibre-game-canvas,
      .territory-interactive-map,
      .territory-frame-map { background: #dbe2d8 !important; }
      time,
      .post-author > span,
      .profile-joined,
      .recording-header strong,
      .live-stats strong,
      .completed-metrics strong {
        color: transparent !important;
        text-shadow: none !important;
      }
    `,
  });
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    if ("fonts" in document) await document.fonts.ready;
  });
}

async function expectMobileScreen(page: Page, name: string) {
  await stabilize(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    maxDiffPixelRatio: 0.012,
  });
}

test("landing, giriş ve kayıt mobil sürüm görselleri sabittir", async ({ page }) => {
  await openRoute(page, "/", /Adımlarınla/);
  await expectMobileScreen(page, "01-landing");

  await openRoute(page, "/login", /Haritana geri dön/);
  await expectMobileScreen(page, "02-login");

  await openRoute(page, "/register", /Şehrinde ilk alanını oluştur/);
  await expectMobileScreen(page, "03-register");
});

test("ana gezinme ekranlarının 390x844 mobil görselleri sabittir", async ({ page }) => {
  const screens = [
    ["/demo/home", "Akışın", "04-home"],
    ["/demo/explore", "Keşfet", "05-explore"],
    ["/demo/play", /Stratejik rotanı başlat/, "06-map"],
    ["/demo/leaderboard", "Sıralama", "07-leaderboard"],
    ["/demo/profile", page.locator(".profile-identity h1"), "08-profile"],
  ] as const;

  for (const [path, ready, name] of screens) {
    await openRoute(page, path, ready);
    if (path === "/demo/play") await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
    await expectMobileScreen(page, name);
  }
});

test("gönderi oluşturucu davranışı ve özgür loop paneli korunur", async ({ page }) => {
  await openRoute(page, "/demo/home", "Akışın");
  await page.getByRole("button", { name: /Alanını ölümsüzleştir/ }).click();
  const composer = page.getByRole("dialog", { name: "Alanını ölümsüzleştir" });
  await expect(composer).toBeVisible();
  await composer.getByPlaceholder("Rotana kısa bir başlık ver").fill("Caddebostan renk rotası");
  await expect(composer.getByLabel(/Açıklama/)).toBeVisible();
  await expect(composer.getByLabel(/İlgili alan/)).toBeVisible();
  await expect(composer.getByRole("button", { name: /Fotoğraf ekle/ })).toBeVisible();
  await expect(composer.getByRole("button", { name: "Paylaş" })).toBeDisabled();

  await composer.getByRole("button", { name: "Pencereyi kapat" }).click();
  await openRoute(page, "/demo/play", /Stratejik rotanı başlat/);
  await page.getByRole("button", { name: "Harekete geç" }).click();
  await expect(page.getByText("Rota canlı kaydediliyor", { exact: true })).toBeVisible();

  // Son konum başlangıca değil, ilk kuzey segmentinin orta bölümüne temas eder.
  for (const key of ["w", "w", "w", "w", "d", "d", "d", "d", "s", "s", "a", "a", "a", "a"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(30);
  }
  await expect(page.getByRole("dialog", { name: "Yeni bir alan kapatabilirsin." })).toBeVisible();
  await expectMobileScreen(page, "09-loop-panel");
});
