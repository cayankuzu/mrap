import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, openRoute, watchBrowserFailures } from "./support";

test.describe("üç motorlu kritik smoke", () => {
  test("tanıtım ekranı açılır", async ({ page }) => {
    const health = watchBrowserFailures(page);
    await openRoute(page, "/", /Adımlarınla/);
    await expect(page.locator(".landing-metrics, .hero-trust"), "Dogrulanmamis tanitim istatistikleri gosterilmemeli").toHaveCount(0);
    await expect(page.locator(".landing-footer")).toContainText("Sürüm 0.1.1");
    await expectNoHorizontalOverflow(page, "tanıtım");
    await health.assertClean();
  });

  test("giriş ekranı açılır", async ({ page }) => {
    const health = watchBrowserFailures(page);
    await openRoute(page, "/login", /Haritana geri dön/);
    await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "giriş");
    await health.assertClean();
  });

  test("kayıt ekranı açılır", async ({ page }) => {
    const health = watchBrowserFailures(page);
    await openRoute(page, "/register", /Şehrinde ilk alanını oluştur/);
    await expect(page.getByRole("button", { name: "Hesap oluştur" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "kayıt");
    await health.assertClean();
  });

  test("demo ana akış açılır", async ({ page }) => {
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/home", "Akışın");
    await expect(page.locator("article.post-card").first()).toBeVisible();
    await expectNoHorizontalOverflow(page, "demo ana akış");
    await health.assertClean();
  });

  test("demo harita hazır veya erişilebilir hata durumundadır", async ({ page }, testInfo) => {
    test.slow(testInfo.project.name === "webkit", "WebKit büyük MapLibre istemci paketini daha yavaş başlatır.");
    const health = watchBrowserFailures(page, {
      ignoreConsoleErrors: testInfo.project.name === "webkit" ? [/^WebGL: context lost\.$/] : [],
    });
    const routeReady = page.getByRole("heading", { name: /Stratejik rotanı başlat/ })
      .or(page.getByText("Oyun haritası yükleniyor", { exact: true }));
    await openRoute(page, "/demo/play", routeReady);
    await expect(page.getByRole("region", { name: "Canlı oyun haritası" })).toBeAttached({ timeout: 60_000 });
    await expect(page.locator(".maplibre-game-canvas:visible, .map-loading.is-error:visible").first()).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalOverflow(page, "demo harita");
    await health.assertClean();
  });

  test("demo profil açılır", async ({ page }) => {
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/profile", page.locator(".profile-identity h1"));
    await expect(page.getByRole("link", { name: "Profil ayarlarını aç" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "demo profil");
    await health.assertClean();
  });

  test("yorum paneli gönderim, Escape ve odak dönüşünü korur", async ({ page }, testInfo) => {
    if (testInfo.project.name === "webkit") test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const health = watchBrowserFailures(page, {
      ignoreConsoleErrors: testInfo.project.name === "webkit" ? [/^WebGL: context lost\.$/] : [],
    });
    await openRoute(page, "/demo/home", "Akışın");

    const firstPost = page.locator("article.post-card").first();
    const trigger = firstPost.getByRole("button", { name: /yorumu göster/ });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await trigger.press("Enter");

    const dialog = page.getByRole("dialog", { name: /Yorumlar/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Yorumlar panelini kapat" })).toBeFocused();

    const uniqueComment = `E2E ${testInfo.project.name} ${Date.now()}`;
    const composer = dialog.getByRole("textbox", { name: "Yorumun" });
    const submit = dialog.getByRole("button", { name: "Yorumu gönder" });
    const submitHandle = await submit.elementHandle();
    expect(submitHandle, "Yorum gönderme düğmesi DOM'da bulunmalı").not.toBeNull();
    await expect(composer).toBeVisible();
    await composer.fill(uniqueComment);
    await expect(submit).toBeEnabled();
    await submitHandle!.dispatchEvent("click");
    await expect(dialog.getByText(uniqueComment, { exact: true })).toBeVisible();
    await expect(composer).toHaveValue("");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    health.expectNavigationAbort();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html[data-mrap-hydrated='true']"), "Yeniden yüklenen demo etkileşime hazır olmalı").toHaveCount(1);
    const restoredTrigger = page.locator("article.post-card").first().getByRole("button", { name: /yorumu göster/ });
    await restoredTrigger.click();
    await expect(page.getByRole("dialog", { name: /Yorumlar/ }).getByText(uniqueComment, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expectNoHorizontalOverflow(page, "yorum paneli kapandıktan sonra");
    await health.assertClean();
  });

  test("demo kaydetme durumu profil sekmesine ve yeniden yüklemeye yansır", async ({ page }) => {
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/home", "Akışın");
    const firstPost = page.locator("article.post-card").first();
    const postId = await firstPost.getAttribute("id");
    expect(postId).toBeTruthy();
    await firstPost.getByRole("button", { name: "Gönderiyi kaydet" }).click();
    await expect(firstPost.getByRole("button", { name: "Gönderiyi kaydedilenlerden çıkar" })).toBeVisible();

    await page.goto("/demo/profile", { waitUntil: "domcontentloaded" });
    await page.locator(".profile-content-tabs button").nth(1).click();
    await expect(page.locator(`article#${postId}`)).toBeVisible();
    health.expectNavigationAbort();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".profile-content-tabs button").nth(1).click();
    await expect(page.locator(`article#${postId}`)).toBeVisible();
    await health.assertClean();
  });

  test("fotoğraf büyütme ve yatay kaydırma bütün tarayıcılarda çalışır", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/home", "Akışın");

    const gallery = page.locator('section[aria-label="2 fotoğraflı galeri"]').first();
    await gallery.getByRole("button", { name: /1\. fotoğrafı büyüt/ }).click();
    const dialog = page.getByRole("dialog", { name: "Fotoğraf 1/2" });
    await expect(dialog).toBeVisible();

    const surface = dialog.getByLabel("Fotoğraflar arasında kaydır");
    const bounds = await surface.boundingBox();
    expect(bounds, "Kaydırma yüzeyi ölçülebilir olmalı").not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width * 0.8, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width * 0.2, bounds!.y + bounds!.height / 2, { steps: 5 });
    await page.mouse.up();

    await expect(page.getByRole("dialog", { name: "Fotoğraf 2/2" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Fotoğraf/ })).toBeHidden();
    await health.assertClean();
  });
});
