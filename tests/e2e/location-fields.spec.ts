import { expect, test } from "@playwright/test";

test("şehir seçici ülkeye bağlı çalışır ve Türkiye ilçelerini göstermez", async ({ page }) => {
  await page.goto("/register");
  const cityInput = page.getByPlaceholder("Şehir ara");
  const countrySelect = page.getByRole("combobox", { name: /yaşadığın ülke/i });
  const countryOptions = countrySelect.locator("option");
  await expect.poll(() => countryOptions.count()).toBeGreaterThan(240);

  await cityInput.fill("Kadıköy");
  const cityListbox = page.getByRole("listbox", { name: /Türkiye şehirleri/i });
  await expect(cityListbox).toBeVisible();
  await expect(cityListbox.getByRole("option")).toHaveCount(0);
  await expect(cityListbox).toContainText("Aramana uygun şehir bulunamadı");

  await cityInput.fill("");
  await expect(cityListbox.getByRole("option")).toHaveCount(81);
  await expect(cityListbox.getByRole("option", { name: /Kadıköy/ })).toHaveCount(0);
  await expect(cityListbox.getByRole("option", { name: /Çankaya/ })).toHaveCount(0);

  await cityInput.fill("ankara");
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

  await countrySelect.selectOption("DE");
  await expect(cityInput).toHaveValue("");
  await cityInput.fill("Berlin");
  const germanyListbox = page.getByRole("listbox", { name: /Almanya şehirleri/i });
  await expect(germanyListbox.getByRole("option", { name: /^Berlin/ }).first()).toBeVisible();
  await germanyListbox.getByRole("option", { name: /^Berlin/ }).first().click();
  await expect(page.locator('input[name="cityId"]')).toHaveValue(/^csc:DE:/);
});
