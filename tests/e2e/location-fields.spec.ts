import { expect, test } from "@playwright/test";

test("şehir seçici klavyeyle aranır, gezinilir ve seçilir", async ({ page }) => {
  await page.goto("/register");
  const cityInput = page.getByPlaceholder("Şehir ara");
  const countryOptions = page.getByRole("combobox", { name: /yaşadığın ülke/i }).locator("option");
  await expect.poll(() => countryOptions.count()).toBeGreaterThan(240);

  await cityInput.fill("ankara");
  const cityListbox = page.getByRole("listbox", { name: /Türkiye şehirleri/i });
  await expect(cityListbox).toBeVisible();
  await expect(cityListbox.getByRole("option").first()).toBeVisible();

  await cityInput.press("ArrowDown");
  const activeId = await cityInput.getAttribute("aria-activedescendant");
  expect(activeId).toBeTruthy();
  await expect(page.locator(`#${activeId}`)).toHaveAttribute("data-highlighted", "true");

  await cityInput.press("Enter");
  await expect(cityInput).toHaveAttribute("aria-expanded", "false");
  await expect(cityInput).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator('input[name="cityId"]')).toHaveValue(/^csc:TR:/);
});
