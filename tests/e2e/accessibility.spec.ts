import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openRoute, watchBrowserFailures } from "./support";

test.skip(({ browserName }) => browserName !== "chromium", "Axe kapısı Chromium üzerinde tek kez çalışır.");

const criticalRoutes = [
  ["/", /Adımlarınla/],
  ["/login", /Haritana geri dön/],
  ["/register", /Şehrinde ilk alanını oluştur/],
  ["/demo/home", "Akışın"],
  ["/demo/explore", "Keşfet"],
  ["/demo/play", /Stratejik rotanı başlat/],
  ["/demo/leaderboard", "Sıralama"],
  ["/demo/profile", /.+/],
] as const;

async function expectNoSeriousAxeViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(({ impact }) => impact === "critical" || impact === "serious");
  const summary = blocking.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target.join(" "),
      html: node.html,
      failureSummary: node.failureSummary,
    })),
  }));
  expect(summary, `${context}: axe critical/serious ihlalleri`).toEqual([]);
}

test.describe("WCAG 2.2 AA kritik/serious kapısı", () => {
  for (const [path, heading] of criticalRoutes) {
    test(`${path} erişilebilirlik kapısını geçer`, async ({ page }) => {
      const health = watchBrowserFailures(page);
      await openRoute(page, path, heading);
      await expectNoSeriousAxeViolations(page, path);
      await health.assertClean();
    });
  }

  test("sıralama çoklu konum paneli erişilebilirlik kapısını geçer", async ({ page }) => {
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/leaderboard", "Sıralama");
    await page.locator(".leaderboard-multiselect summary").click();
    await expect(page.locator(".leaderboard-multiselect-panel")).toBeVisible();
    await expectNoSeriousAxeViolations(page, "sıralama çoklu konum paneli");
    await health.assertClean();
  });

  test("yorum paneli erişilebilirlik kapısını geçer", async ({ page }) => {
    const health = watchBrowserFailures(page);
    await openRoute(page, "/demo/home", "Akışın");
    await page.locator("article.post-card").first().getByRole("button", { name: /yorumu göster/ }).click();
    const dialog = page.getByRole("dialog", { name: /Yorumlar/ });
    await expect(dialog).toBeVisible();
    await expectNoSeriousAxeViolations(page, "yorum paneli");
    await health.assertClean();
  });
});
