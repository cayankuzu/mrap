import type { CDPSession, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, openRoute, watchBrowserFailures } from "./support";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent: "Mozilla/5.0 (Linux; Android 15; mrap-interaction-test) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
});

test.skip(({ browserName }) => browserName !== "chromium", "Gerçek dokunma ve konum izinleri Chromium mobil bağlamında doğrulanır.");

async function openLocationPanel(page: Page) {
  await page.getByRole("button", { name: /WASD \/ yön tuşları panelini aç|Konum test panelini aç/ }).click();
  const panel = page.getByRole("complementary", { name: "Konum test paneli" });
  await expect(panel).toBeVisible();
  return panel;
}

async function dispatchTouchSwipe(session: CDPSession, surface: Locator, direction: "left" | "right") {
  const box = await surface.boundingBox();
  expect(box, "Kaydırma yüzeyi görünür olmalı").not.toBeNull();
  if (!box) return;

  const startX = direction === "left" ? box.x + box.width * 0.78 : box.x + box.width * 0.22;
  const endX = direction === "left" ? box.x + box.width * 0.22 : box.x + box.width * 0.78;
  const y = box.y + box.height * 0.5;
  const touchPoint = (x: number) => ({ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 });

  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(startX)] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touchPoint((startX + endX) / 2)] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touchPoint(endX)] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.describe("mobil gerçek kullanıcı etkileşimleri", () => {
  test("reddedilen gerçek konum izninden sanal GPS'e güvenli biçimde geçilir", async ({ page }) => {
    await page.addInitScript(() => {
      const denied = { code: 1, message: "User denied Geolocation", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
      const geolocation = {
        getCurrentPosition: (_success: PositionCallback, error?: PositionErrorCallback | null) => {
          window.setTimeout(() => error?.(denied as GeolocationPositionError), 0);
        },
        watchPosition: (_success: PositionCallback, error?: PositionErrorCallback | null) => {
          window.setTimeout(() => error?.(denied as GeolocationPositionError), 0);
          return 1;
        },
        clearWatch: () => undefined,
      } satisfies Geolocation;
      Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: geolocation });
    });
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/play", /Stratejik rotanı başlat/);

    const panel = await openLocationPanel(page);
    await panel.getByRole("button", { name: "Gerçek konum" }).click();
    await page.locator(".game-session-card").getByRole("button", { name: "Harekete geç" }).click();

    await expect(panel).toContainText("İzin verilmedi");
    await expect(page.locator(".claim-toast[role='alert']")).toContainText("Gerçek konum için adres çubuğundaki konum iznini aç");
    await expect(page.getByText("Rota canlı kaydediliyor", { exact: true })).toHaveCount(0);

    await panel.getByRole("button", { name: "Sanal konum" }).click();
    await expect(panel).toContainText("Sanal konum hazır");
    await panel.getByRole("button", { name: "Paneli kapat" }).click();
    await expect(panel).toHaveCount(0);
    await page.locator(".game-session-card").getByRole("button", { name: "Harekete geç" }).click();
    await expect(page.getByText("Rota canlı kaydediliyor", { exact: true })).toBeVisible();
    await page.locator(".game-session-card").getByRole("button", { name: "Takibi bitir" }).click();
    await expect(page.getByText("Oturum tamamlandı", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page, "konum izni reddi ve sanal GPS geçişi");
    await health.assertClean();
  });

  test("izin verilen gerçek GPS doğru hassasiyetle rota kaydını başlatır", async ({ page }) => {
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/play", /Stratejik rotanı başlat/);
    await page.context().setGeolocation({ latitude: 41.0082, longitude: 28.9784, accuracy: 6 });
    await page.context().grantPermissions(["geolocation"], { origin: new URL(page.url()).origin });

    const panel = await openLocationPanel(page);
    await panel.getByRole("button", { name: "Gerçek konum" }).click();
    await page.locator(".game-session-card").getByRole("button", { name: "Harekete geç" }).click();

    await expect(page.getByText("Rota canlı kaydediliyor", { exact: true })).toBeVisible();
    await expect(panel).toContainText(/Konum(?: hazır)? · ±6 m/);
    await expect.poll(() => page.evaluate(async () => (await navigator.permissions.query({ name: "geolocation" })).state)).toBe("granted");
    await page.locator(".game-session-card").getByRole("button", { name: "Takibi bitir" }).click();
    await expect(page.getByText("Oturum tamamlandı", { exact: true })).toBeVisible();
    await health.assertClean();
  });

  test("çoklu fotoğraflar gerçek dokunma hareketiyle değişir ve mini harita etkileşimli açılır", async ({ page }) => {
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/home", "Akışın");
    const post = page.locator("article.post-card").first();
    await expect(post.locator(".post-media-thumb")).toHaveCount(2);

    await post.locator(".post-media-thumb").first().click();
    let photoDialog = page.getByRole("dialog", { name: "Fotoğraf 1/2" });
    await expect(photoDialog).toBeVisible();
    await expect(photoDialog.locator(".lightbox-photo")).toHaveClass(/post-photo--sunset/);

    const cdp = await page.context().newCDPSession(page);
    await dispatchTouchSwipe(cdp, photoDialog.locator(".lightbox-photo-swipe-surface"), "left");
    photoDialog = page.getByRole("dialog", { name: "Fotoğraf 2/2" });
    await expect(photoDialog).toBeVisible();
    await expect(photoDialog.locator(".lightbox-photo")).toHaveClass(/post-photo--city/);
    await dispatchTouchSwipe(cdp, photoDialog.locator(".lightbox-photo-swipe-surface"), "right");
    await expect(page.getByRole("dialog", { name: "Fotoğraf 1/2" })).toBeVisible();
    await page.getByRole("button", { name: "Paneli kapat" }).click();

    const miniMap = post.locator(".territory-interactive-map");
    await expect(miniMap.locator(".maplibregl-canvas")).toBeVisible();
    await miniMap.click({ position: { x: 42, y: 42 } });
    const mapDialog = page.getByRole("dialog", { name: "Caddebostan Sahil Turu · Kadıköy, İstanbul" });
    await expect(mapDialog).toBeVisible();
    const expandedMap = mapDialog.getByRole("application", { name: "Caddebostan Sahil Turu büyütülmüş etkileşimli haritası" });
    const mapTouchSurface = mapDialog.locator(".maplibregl-canvas-container.maplibregl-interactive");
    await expect(expandedMap).toBeVisible();
    await expect(mapTouchSurface).toHaveCount(1);
    await expect(mapDialog.getByText("Alan çevresinde sınırlı gezinme", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      const target = window as typeof window & { __mrapMapEvents?: Array<{ type: string; className: string; pointerType?: string }> };
      target.__mrapMapEvents = [];
      for (const type of ["pointerdown", "pointermove", "touchstart", "touchmove"]) {
        document.addEventListener(type, (event) => {
          const element = event.target instanceof Element ? event.target : null;
          target.__mrapMapEvents?.push({
            type,
            className: element?.className?.toString() ?? "",
            pointerType: event instanceof PointerEvent ? event.pointerType : undefined,
          });
        }, { capture: true, passive: true });
      }
    });
    await dispatchTouchSwipe(cdp, mapTouchSurface, "right");
    const mapEvents = await page.evaluate(() => (window as typeof window & { __mrapMapEvents?: Array<{ type: string; className: string; pointerType?: string }> }).__mrapMapEvents ?? []);
    expect(
      mapEvents.some((event) => /maplibregl|territory-interactive/.test(event.className) && (event.type.startsWith("touch") || event.pointerType === "touch")),
      `Büyütülmüş MapLibre yüzeyi gerçek dokunma hareketini almalı: ${JSON.stringify(mapEvents)}`,
    ).toBe(true);
    await expect(mapDialog).toBeVisible();
    await mapDialog.getByRole("button", { name: "Paneli kapat" }).click();
    await expectNoHorizontalOverflow(page, "fotoğraf galerisi ve etkileşimli harita");
    await cdp.detach();
    await health.assertClean();
  });

  test("takipçi ve takip edilen panellerinden ilgili kullanıcı profiline geçilir", async ({ page }) => {
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/profile", page.locator(".profile-identity h1"));
    const connections = page.locator(".profile-connection-buttons");

    await connections.getByRole("button", { name: /Takipçi/ }).click();
    const followers = page.getByRole("dialog", { name: "Takipçiler" });
    await expect(followers).toBeVisible();
    await expect(followers.locator(".connection-list a")).toHaveCount(8);
    await followers.getByRole("link", { name: /Mert Aksoy/ }).click();
    await expect(page).toHaveURL(/\/demo\/users\/mertx$/);
    await expect(page.getByRole("heading", { name: "Mert Aksoy" })).toBeVisible();

    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".profile-identity h1")).toHaveText("Cayan Akın");
    await page.locator(".profile-connection-buttons").getByRole("button", { name: /^5 Takip$/ }).click();
    const following = page.getByRole("dialog", { name: "Takip edilenler" });
    await expect(following).toBeVisible();
    await expect(following.locator(".connection-list a")).toHaveCount(5);
    await following.getByRole("link", { name: /Ece Güner/ }).click();
    await expect(page).toHaveURL(/\/demo\/users\/ecewrap$/);
    await expect(page.getByRole("heading", { name: "Ece Güner" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "bağlantı listesinden profil geçişi");
    await health.assertClean();
  });
});
