import { expect, test } from "./fixtures";
import { openRoute, watchBrowserFailures } from "./support";

test.describe("demo sosyal durum eşitliği", () => {
  test("açık takip, gizli takip isteği ve paylaşım reload sonrasında korunur", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (value: string) => { window.sessionStorage.setItem("mrap:e2e:last-copy", value); } },
      });
    });
    const health = watchBrowserFailures(page);

    await openRoute(page, "/demo/users/selinmoves", "Selin Işık");
    await page.getByRole("button", { name: "Takip et" }).click();
    await expect(page.getByRole("button", { name: "Takiptesin" })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html[data-mrap-hydrated='true']")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Takiptesin" })).toBeVisible();

    await openRoute(page, "/demo/users/denizaras", "Deniz Aras");
    await expect(page.getByRole("heading", { name: "Bu hesap gizli" })).toBeVisible();
    await page.getByRole("button", { name: "Takip et" }).click();
    await expect(page.getByRole("button", { name: "İstek gönderildi" })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html[data-mrap-hydrated='true']")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "İstek gönderildi" })).toBeVisible();
    await expect(page.getByText("Takip isteğin gönderildi. Kabul edildiğinde gönderileri görebileceksin.")).toBeVisible();
    await page.locator(".profile-connection-buttons").getByRole("button", { name: /Takipçi/ }).click();
    await expect(page.getByRole("dialog", { name: "Takipçiler" })).toContainText("Bağlantılar gizli");

    await openRoute(page, "/demo/home", "Akışın");
    const firstPost = page.locator("article.post-card").first();
    await firstPost.getByRole("button", { name: "Paylaş", exact: true }).click();
    await expect(firstPost.getByRole("button", { name: "Kopyalandı" })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html[data-mrap-hydrated='true']")).toHaveCount(1);
    await expect(page.locator("article.post-card").first().getByRole("button", { name: "Paylaşıldı" })).toBeVisible();
    await health.assertClean();
  });
});
