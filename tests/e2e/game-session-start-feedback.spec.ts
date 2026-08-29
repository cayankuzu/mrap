import { expect, test } from "./fixtures";
import { openRoute } from "./support";
import type { Page } from "@playwright/test";

async function registerLocalPlayer(page: Page) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  await openRoute(page, "/register", /Şehrinde ilk alanını oluştur/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Ad soyad").fill("Konum Testi");
  await page.getByLabel("Kullanıcı adı").fill(`konum${suffix}`.slice(0, 20));
  await page.getByLabel("Doğum tarihi / yaş").fill("1995-05-17");
  await page.getByLabel("E-posta adresi").fill(`konum-${suffix}@example.test`);
  await page.getByLabel("Şifre", { exact: true }).fill("MrapTest!2026");
  await page.getByRole("checkbox", { name: /Kullanım koşullarını/ }).check();
  await expect(page.locator("#username-availability")).toContainText("Kullanıcı adı kullanılabilir.");
  await expect(page.locator("#email-availability")).toContainText("E-posta adresi kullanılabilir.");
  const submit = page.getByRole("button", { name: "Hesap oluştur" });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();
  await page.waitForURL(/\/home$/, { timeout: 20_000 });
}

test("Harekete geç işlemi konum beklenirken anlık geri bildirim gösterir", async ({ page }) => {
  await page.addInitScript(() => {
    const position = (): GeolocationPosition => ({
      coords: {
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        latitude: 40.987,
        longitude: 29.027,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    });
    const geolocation: Geolocation = {
      getCurrentPosition(success) { window.setTimeout(() => success(position()), 900); },
      watchPosition(success) { window.setTimeout(() => success(position()), 0); return 1; },
      clearWatch() {},
    };
    Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: geolocation });
  });

  await openRoute(page, "/demo/play", /Stratejik rotanı başlat/);
  await page.getByRole("button", { name: /WASD \/ yön tuşları panelini aç|Konum test panelini aç/ }).click();
  const panel = page.getByRole("complementary", { name: "Konum test paneli" });
  await panel.getByRole("button", { name: "Gerçek konum" }).click();
  await panel.getByRole("button", { name: "Paneli kapat" }).click();

  await page.locator(".game-session-card").getByRole("button", { name: "Harekete geç" }).click();
  await expect(page.getByRole("button", { name: "Başlatılıyor…" })).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Konum ve güvenli oyun oturumu hazırlanıyor…" })).toBeVisible();
  await expect(page.getByText("Rota canlı kaydediliyor", { exact: true })).toBeVisible();
});

test("gerçek oyun ekranı konumu önceden ister ve taze örneği başlatmada yeniden kullanır", async ({ page }) => {
  await page.addInitScript(() => {
    type HeadingTestWindow = typeof window & {
      __mrapLocationRequestCount?: number;
      __mrapHeadingPermissionCount?: number;
      __mrapEmitOrientation?: () => void;
    };
    const testWindow = window as HeadingTestWindow;
    testWindow.__mrapLocationRequestCount = 0;
    testWindow.__mrapHeadingPermissionCount = 0;
    class MockDeviceOrientationEvent extends Event {
      alpha: number | null;
      beta: number | null = null;
      gamma: number | null = null;
      absolute: boolean;

      static async requestPermission() {
        testWindow.__mrapHeadingPermissionCount = (testWindow.__mrapHeadingPermissionCount ?? 0) + 1;
        return "granted" as const;
      }

      constructor(type: string, init: { alpha: number; absolute: boolean }) {
        super(type);
        this.alpha = init.alpha;
        this.absolute = init.absolute;
      }
    }
    Object.defineProperty(window, "DeviceOrientationEvent", { configurable: true, value: MockDeviceOrientationEvent });
    testWindow.__mrapEmitOrientation = () => window.dispatchEvent(new MockDeviceOrientationEvent("deviceorientationabsolute", { alpha: 270, absolute: true }));
    const position = (): GeolocationPosition => ({
      coords: {
        accuracy: 4,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        latitude: 40.987,
        longitude: 29.027,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    });
    const geolocation: Geolocation = {
      getCurrentPosition(success) {
        testWindow.__mrapLocationRequestCount = (testWindow.__mrapLocationRequestCount ?? 0) + 1;
        window.setTimeout(() => success(position()), 0);
      },
      watchPosition(success) { window.setTimeout(() => success(position()), 0); return 1; },
      clearWatch() {},
    };
    Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: geolocation });
  });

  await registerLocalPlayer(page);
  await openRoute(page, "/play", /Stratejik rotanı başlat/);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __mrapLocationRequestCount?: number }).__mrapLocationRequestCount ?? 0)).toBe(1);

  const sessionCard = page.locator(".game-session-card");
  const start = sessionCard.getByRole("button", { name: "Harekete geç" });
  await expect(start).toBeEnabled({ timeout: 20_000 });
  await start.click();
  await expect(page.getByText("Rota güvenle kaydediliyor", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __mrapLocationRequestCount?: number }).__mrapLocationRequestCount ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __mrapHeadingPermissionCount?: number }).__mrapHeadingPermissionCount ?? 0)).toBe(1);
  await page.evaluate(() => (window as typeof window & { __mrapEmitOrientation?: () => void }).__mrapEmitOrientation?.());
  const liveMap = page.getByRole("region", { name: "Canlı oyun haritası" });
  await expect(liveMap).toHaveAttribute("data-player-heading", "90");
  await expect(liveMap).toHaveAttribute("data-player-heading-source", "device");
  await expect(page.locator("#player-heading-description")).toHaveText("Baktığın yön: Doğu, 90 derece.");

  await sessionCard.getByRole("button", { name: "Takibi bitir" }).click();
  await expect(page.getByText("Oturum tamamlandı", { exact: true })).toBeVisible({ timeout: 30_000 });
});
