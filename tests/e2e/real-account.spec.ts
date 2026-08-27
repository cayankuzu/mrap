import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, openRoute, watchBrowserFailures } from "./support";

test.describe("gerçek hesap yaşam döngüsü", () => {
  test("Unicode kayıt, çıkış, yeniden giriş ve onaylı hesap silme çalışır", async ({ page }, testInfo) => {
    const health = watchBrowserFailures(page, {
      // This test intentionally verifies the deleted account's 401 response.
      ignoreConsoleErrors: [/Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/],
    });
    const unique = `${testInfo.project.name.slice(0, 2)}${Date.now().toString(36).slice(-7)}`;
    const requestedUsername = `IŞIK_${unique}`.slice(0, 20);
    const normalizedUsername = requestedUsername.toLocaleLowerCase("tr-TR");
    const email = `e2e-${unique}@example.test`;
    const password = "Guvenli12345";

    await openRoute(page, "/register", /Şehrinde ilk alanını oluştur/);
    // `load` can precede React hydration in Next.js development mode. Waiting for
    // the initial client chunks keeps fills from racing the controlled inputs.
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Ad soyad").fill("Işık İpek");
    await page.getByLabel("Kullanıcı adı").fill(requestedUsername);
    await page.getByLabel("Doğum tarihi / yaş").fill("1995-05-17");
    await page.getByLabel("E-posta adresi").fill(email);
    await page.getByLabel("Şifre", { exact: true }).fill(password);
    await page.getByRole("checkbox", { name: /Kullanım koşullarını/ }).check();
    await expect(page.locator("#username-availability")).toContainText("Kullanıcı adı kullanılabilir.");
    await expect(page.locator("#email-availability")).toContainText("E-posta adresi kullanılabilir.");
    const register = page.getByRole("button", { name: "Hesap oluştur" });
    await expect(register).toBeEnabled({ timeout: 15_000 });
    await register.click();
    await page.waitForURL(/\/home$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Akışın", exact: true })).toBeVisible();

    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".profile-identity")).toContainText(`@${normalizedUsername}`);
    await expectNoHorizontalOverflow(page, `${testInfo.project.name} gerçek profil`);

    const logoutResponse = await page.evaluate(async () => {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      return { status: response.status, body: await response.text() };
    });
    expect(logoutResponse.status, logoutResponse.body).toBe(200);
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel("E-posta adresi").fill(email);
    await page.getByLabel("Şifre", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await page.waitForURL(/\/home$/, { timeout: 20_000 });

    await page.goto("/settings", { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: /^Ayarlar/ }).click();
    await page.getByRole("button", { name: "Hesabı kalıcı olarak sil" }).click();
    const dialog = page.getByRole("dialog", { name: "Hesabını kalıcı olarak sil" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Devam etmek için/).fill(normalizedUsername);
    await dialog.getByLabel("Mevcut şifren").fill(password);
    await dialog.getByRole("checkbox", { name: /geri alınamayacağını/ }).check();
    await dialog.getByRole("button", { name: "Hesabımı sil" }).click();
    await page.waitForURL(/\/login\?hesap=silindi$/, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");

    await page.getByLabel("E-posta adresi").fill(email);
    await page.getByLabel("Şifre", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page.locator(".form-error[role='alert']")).toContainText("E-posta veya şifre hatalı");
    await health.assertClean();
  });
});
