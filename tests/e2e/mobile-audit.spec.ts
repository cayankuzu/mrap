import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, openRoute, watchBrowserFailures } from "./support";

const mobileRoutes = [
  ["/", /Adımlarınla/],
  ["/login", /Haritana geri dön/],
  ["/register", /Şehrinde ilk alanını oluştur/],
  ["/forgot-password", /Şifreni yenile/],
  ["/privacy", /Konumunun kontrolü sende/],
  ["/terms", /Gerçek dünya önce güvenlik/],
  ["/help", /İlk alanını üç adımda kapat/],
  ["/demo/home", "Akışın"],
  ["/demo/explore", "Keşfet"],
  ["/demo/play", /Stratejik rotanı başlat/],
  ["/demo/leaderboard", "Sıralama"],
  ["/demo/profile", /.+/],
  ["/demo/notifications", "Bildirimler"],
  ["/demo/settings", "Ayarlar"],
] as const;

test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile-"), "Bu paket yalnız ayrılmış mobil görünüm projelerinde çalışır.");
});

async function dispatchPullGestureOn(target: import("@playwright/test").Locator) {
  return target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const startY = bounds.top + bounds.height / 2;
    const createTouch = (y: number) => new Touch({ identifier: 1, target: element, clientX: x, clientY: y, radiusX: 7, radiusY: 7, force: 1 });
    const dispatch = (type: "touchstart" | "touchmove" | "touchend", y: number) => {
      const touch = createTouch(y);
      return element.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === "touchend" ? [] : [touch],
        targetTouches: type === "touchend" ? [] : [touch],
        changedTouches: [touch],
      }));
    };
    const inDialog = Boolean(element.closest("[role='dialog']"));
    dispatch("touchstart", startY);
    const moveResults = [0.25, 0.5, 0.75, 1].map((ratio) => dispatch("touchmove", startY + 100 * ratio));
    dispatch("touchend", startY + 100);
    return { inDialog, moveResults };
  });
}

async function expectMinimumTouchTarget(locator: import("@playwright/test").Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} görünür bir kutuya sahip olmalı`).not.toBeNull();
  expect(box?.width ?? 0, `${label} en az 44px geniş olmalı`).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0, `${label} en az 44px yüksek olmalı`).toBeGreaterThanOrEqual(44);
}

test("bütün mobil ekranlar taşmadan açılır ve sabit gezinme kullanılabilir kalır", async ({ page }, testInfo) => {
  const health = watchBrowserFailures(page);
  for (const [path, heading] of mobileRoutes) {
    await openRoute(page, path, heading);
    await expectNoHorizontalOverflow(page, `${testInfo.project.name} ${path}`);
    if (path.startsWith("/demo/")) {
      await expect(page.locator(".app-topbar")).toBeVisible();
      await expect(page.locator(".bottom-nav")).toBeVisible();
      await expect(page.getByRole("button", { name: "Ekranı yenile" })).toBeHidden();
    }
  }
  await health.assertClean();
});

test("mobil keşfet, profil ve paneller dokunmatik akışta çalışır", async ({ page }, testInfo) => {
  const health = watchBrowserFailures(page);

  await openRoute(page, "/demo/explore", "Keşfet");
  const search = page.getByLabel("Demo kullanıcılarında ara");
  await expect(page.locator(".player-search-results article")).toHaveCount(0);
  await search.fill("selin");
  await expect(page.locator(".player-search-results article")).toHaveCount(1);
  await expect(page.locator(".player-search-results")).toContainText("Selin");
  await search.fill("");
  await expect(page.locator(".player-search-results article")).toHaveCount(0);
  await expectNoHorizontalOverflow(page, `${testInfo.project.name} keşfet araması`);

  await openRoute(page, "/demo/home", "Akışın");
  const firstPost = page.locator("article.post-card").first();
  await firstPost.getByRole("button", { name: /yorumu göster/ }).click();
  const comments = page.getByRole("dialog", { name: /Yorumlar/ });
  await expect(comments).toBeVisible();
  await expectNoHorizontalOverflow(page, `${testInfo.project.name} yorum paneli`);
  await comments.getByRole("button", { name: "Yorumlar panelini kapat" }).click();

  const like = firstPost.getByRole("button", { name: /Beğenenleri görmek için yarım saniye/ });
  await like.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true });
  await page.waitForTimeout(560);
  await like.dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch", isPrimary: true });
  const likes = page.getByRole("dialog", { name: /Beğenenler/ });
  await expect(likes).toBeVisible();
  await expectNoHorizontalOverflow(page, `${testInfo.project.name} beğeni paneli`);
  await likes.getByRole("button", { name: "Beğenenler panelini kapat" }).click();

  await openRoute(page, "/demo/profile", page.locator(".profile-identity h1"));
  const actions = page.locator(".profile-actions");
  await expect(actions.getByRole("link", { name: "Profil ayarlarını aç" })).toBeVisible();
  await expect(actions.getByRole("link", { name: "Gerçek hesap oluştur" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Demodan çık" })).toBeVisible();
  await page.locator(".profile-connection-buttons").getByRole("button", { name: /Takipçi/ }).click();
  const followers = page.getByRole("dialog", { name: "Takipçiler" });
  await expect(followers).toBeVisible();
  await expectNoHorizontalOverflow(page, `${testInfo.project.name} takipçi paneli`);
  await followers.getByRole("button", { name: "Listeyi kapat" }).click();

  await health.assertClean();
});

test("en dar mobil ekranda temel dokunma hedefleri en az 44 piksel kalır", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320x568", "Dokunma hedefleri en dar mobil profilde bir kez doğrulanır.");
  const health = watchBrowserFailures(page);

  await openRoute(page, "/demo/profile", page.locator(".profile-identity h1"));
  await expectMinimumTouchTarget(page.locator(".app-topbar").getByRole("link", { name: "Bildirimler" }), "Bildirimler");
  for (const action of await page.locator(".profile-actions a:visible, .profile-actions button:visible").all()) {
    await expectMinimumTouchTarget(action, (await action.getAttribute("aria-label")) ?? "Profil işlemi");
  }
  for (const navItem of await page.locator(".bottom-nav a").all()) {
    await expectMinimumTouchTarget(navItem, (await navItem.textContent())?.trim() || "Alt gezinme öğesi");
  }

  await openRoute(page, "/demo/settings", "Ayarlar");
  await expectMinimumTouchTarget(page.getByRole("button", { name: "Önceki ekrana dön" }), "Geri");

  await openRoute(page, "/demo/play", /Stratejik rotanı başlat/);
  await expectMinimumTouchTarget(page.getByRole("button", { name: "Konumuma dön" }), "Harita konum kontrolü");
  await expectMinimumTouchTarget(page.getByRole("button", { name: "Rota panelini küçült" }), "Rota paneli küçültme");

  await page.getByRole("button", { name: /Alan \/ boya rengi/ }).click();
  for (const arrow of await page.locator(".color-palette-pagebar > button").all()) {
    await expectMinimumTouchTarget(arrow, (await arrow.getAttribute("aria-label")) ?? "Renk paleti oku");
  }
  for (const dot of await page.locator(".color-palette-dots button").all()) {
    await expectMinimumTouchTarget(dot, (await dot.getAttribute("aria-label")) ?? "Renk paleti sayfası");
  }

  await page.getByRole("button", { name: /WASD \/ yön tuşları panelini aç|Konum test panelini aç/ }).click();
  const developerPanel = page.getByRole("complementary", { name: "Konum test paneli" });
  await expect(developerPanel).toBeVisible();
  for (const control of await developerPanel.getByRole("button").all()) {
    await expectMinimumTouchTarget(control, (await control.getAttribute("aria-label")) ?? ((await control.textContent())?.trim() || "Geliştirici kontrolü"));
  }

  await expectNoHorizontalOverflow(page, "320px dokunma hedefleri");
  await health.assertClean();
});

test("en dar mobil ekranda formlar yakınlaşmaz ve fotoğraf uzun basma etkileşimi yerel menüyle çakışmaz", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320x568", "iOS form ve fotoğraf davranışı en dar mobil profilde bir kez doğrulanır.");
  const health = watchBrowserFailures(page);

  await openRoute(page, "/register", /Şehrinde ilk alanını oluştur/);
  const registrationControls = page.locator('input:visible:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), textarea:visible, select:visible');
  expect(await registrationControls.count(), "Kayıt ekranında görünür form kontrolü bulunmalı").toBeGreaterThan(0);
  for (const control of await registrationControls.all()) {
    const fontSize = await control.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize, "Mobil form kontrolü iOS otomatik yakınlaştırmasını tetiklememeli").toBeGreaterThanOrEqual(16);
  }

  await openRoute(page, "/demo/home", "Akışın");
  await page.getByRole("button", { name: /Alanını ölümsüzleştir/ }).click();
  const composer = page.getByRole("dialog", { name: "Alanını ölümsüzleştir" });
  await expect(composer).toBeVisible();
  await expectMinimumTouchTarget(composer.getByRole("button", { name: "Pencereyi kapat" }), "Gönderi paneli kapatma");

  const composerControls = composer.locator('input:visible:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), textarea:visible, select:visible');
  for (const control of await composerControls.all()) {
    const fontSize = await control.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize, "Gönderi formu iOS otomatik yakınlaştırmasını tetiklememeli").toBeGreaterThanOrEqual(16);
  }

  await page.locator("#photo-upload").setInputFiles({
    name: "mobil-onizleme.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  const photo = composer.locator(".upload-preview-grid > div").first();
  await expect(photo).toBeVisible();
  await expectMinimumTouchTarget(photo.getByRole("button", { name: "1. fotoğrafı kaldır" }), "Fotoğraf kaldırma");
  await expectMinimumTouchTarget(photo.getByRole("button", { name: "1. fotoğrafı büyüt" }), "Fotoğraf büyütme");

  const orderButton = photo.getByRole("button", { name: "1. fotoğrafı sıralamak için seç" });
  const contextMenuPrevented = await orderButton.evaluate((element) => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    return !element.dispatchEvent(event);
  });
  expect(contextMenuPrevented, "Fotoğrafın yerel uzun basma menüsü engellenmeli").toBe(true);

  await orderButton.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 40, clientY: 40 });
  await page.waitForTimeout(550);
  const preview = page.getByRole("dialog", { name: "1. fotoğraf önizlemesi" });
  await expect(preview).toBeVisible();
  await orderButton.dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 40, clientY: 40 });
  await expectMinimumTouchTarget(preview.getByRole("button", { name: "Paneli kapat" }), "Fotoğraf paneli kapatma");
  await preview.getByRole("button", { name: "Paneli kapat" }).click();

  await expectNoHorizontalOverflow(page, "320px form ve fotoğraf etkileşimi");
  await health.assertClean();
});

test("ekran ve panel pull-to-refresh hareketi doğru kapsamı bildirir", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390x844", "Gesture davranışı orta mobil profilde bir kez doğrulanır.");
  const health = watchBrowserFailures(page);
  await openRoute(page, "/demo/home", "Akışın");
  await page.evaluate(() => {
    const target = window as typeof window & { __mrapRefreshEvents?: unknown[] };
    target.__mrapRefreshEvents = [];
    window.addEventListener("mrap:refresh", (event) => {
      target.__mrapRefreshEvents?.push((event as CustomEvent).detail);
    });
  });

  await page.evaluate(() => window.scrollTo(0, 0));
  const screenGesture = await dispatchPullGestureOn(page.getByRole("heading", { name: "Akışın", exact: true }));
  expect(screenGesture.moveResults).toContain(false);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __mrapRefreshEvents?: Array<{ scope: string }> }).__mrapRefreshEvents?.[0]?.scope)).toBe("screen");
  await expect(page.locator(".pull-refresh-indicator")).toHaveAttribute("data-pull-state", "idle");

  await page.locator("article.post-card").first().getByRole("button", { name: /yorumu göster/ }).click();
  const comments = page.getByRole("dialog", { name: /Yorumlar/ });
  const panelTitle = comments.locator("header strong").first();
  const gesture = await dispatchPullGestureOn(panelTitle);
  expect(gesture, "Panel çekme hareketi dialog ağacından başlamalı ve document listener tarafından ele alınmalı").toMatchObject({
    inDialog: true,
    moveResults: expect.arrayContaining([false]),
  });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __mrapRefreshEvents?: Array<{ scope: string }> }).__mrapRefreshEvents?.at(-1)?.scope)).toBe("panel");
  await comments.getByRole("button", { name: "Yorumlar panelini kapat" }).click();
  await health.assertClean();
});

test("mobil sanal GPS başlangıca dönmeden loop kapatır ve oturumu tamamlar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390x844", "Oyun etkileşimi orta mobil profilde bir kez doğrulanır.");
  const health = watchBrowserFailures(page);
  await openRoute(page, "/demo/play", /Stratejik rotanı başlat/);
  await page.getByRole("button", { name: "Harekete geç" }).click();
  await expect(page.getByText("Rota canlı kaydediliyor", { exact: true })).toBeVisible();

  for (const key of ["w", "w", "w", "w", "d", "d", "d", "d", "s", "s", "s", "s", "a", "a", "a", "a"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(25);
  }

  const opportunity = page.getByRole("dialog", { name: "Yeni bir alan kapatabilirsin." });
  await expect(opportunity).toBeVisible();
  await opportunity.getByRole("button", { name: "Alanı Kapat" }).click();
  await expect(page.getByText("Alan güncellendi", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Takibi bitir" }).click();
  await expect(page.getByText("Oturum tamamlandı", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Oturum özetini küçült" }).click();
  await expect(page.getByRole("button", { name: /panelini genişlet/ })).toBeVisible();
  await expectNoHorizontalOverflow(page, "mobil tamamlanmış oyun oturumu");
  await health.assertClean();
});
