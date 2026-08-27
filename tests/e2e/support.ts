import { expect, type ConsoleMessage, type Locator, type Page, type Response } from "@playwright/test";

const ERROR_OVERLAY_SELECTOR = [
  "[data-nextjs-dialog]",
  "[data-nextjs-dialog-overlay]",
  ".vite-error-overlay",
  "#webpack-dev-server-client-overlay",
].join(",");

type BrowserFailure = {
  kind: "console" | "pageerror";
  message: string;
};

function consoleLocation(message: ConsoleMessage) {
  const location = message.location();
  return location.url ? ` (${location.url}:${location.lineNumber ?? 0})` : "";
}

function isFirefoxHarnessAbort(message: ConsoleMessage) {
  const location = message.location();
  return (
    location.url.startsWith("chrome://juggler/content/content/WorkerMain.js") &&
    message.text().includes("NS_BINDING_ABORTED")
  );
}

export function watchBrowserFailures(page: Page, options: { ignoreConsoleErrors?: RegExp[] } = {}) {
  const failures: BrowserFailure[] = [];
  let expectedNavigationAbortUntil = 0;

  const isExpectedMapNavigationAbort = (message: string) => (
    Date.now() <= expectedNavigationAbortUntil
    && /(?:maplibre-gl-worker\.mjs|tiles\.openfreemap\.org\/styles\/positron).*access control checks/i.test(message)
  );

  page.on("console", (message) => {
    if (message.type() === "error") {
      // Firefox/Playwright, sayfa yenilenirken kendi worker'ını iptal ettiğinde
      // uygulama dışındaki bu chrome:// hatasını konsola yazabiliyor.
      if (isFirefoxHarnessAbort(message)) return;
      if (options.ignoreConsoleErrors?.some((pattern) => pattern.test(message.text()))) return;
      failures.push({ kind: "console", message: `${message.text()}${consoleLocation(message)}` });
    }
  });
  page.on("pageerror", (error) => {
    const message = error.stack ?? error.message;
    if (isExpectedMapNavigationAbort(message)) return;
    failures.push({ kind: "pageerror", message });
  });

  return {
    expectNavigationAbort(durationMs = 2_500) {
      expectedNavigationAbortUntil = Date.now() + durationMs;
    },
    async assertClean() {
      await expect(
        page.locator(ERROR_OVERLAY_SELECTOR).filter({ visible: true }),
        "Next.js/Vite hata katmanı görünmemeli",
      ).toHaveCount(0);
      expect(failures, `Tarayıcı çalışma zamanı hataları:\n${failures.map((failure) => `[${failure.kind}] ${failure.message}`).join("\n")}`).toEqual([]);
    },
  };
}

export async function openRoute(page: Page, path: string, ready: Locator | RegExp | string): Promise<Response | null> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await page.goto(path, { waitUntil: "domcontentloaded" });
      break;
    } catch (error) {
      const transientNetworkChange = error instanceof Error && /ERR_NETWORK_CHANGED|NS_ERROR_NET_RESET/.test(error.message);
      if (!transientNetworkChange || attempt > 0) throw error;
      await page.waitForTimeout(100);
    }
  }
  expect(response, `${path} bir belge yanıtı döndürmeli`).not.toBeNull();
  expect(response?.status() ?? 599, `${path} başarılı yanıt vermeli`).toBeLessThan(400);
  await expect(page.locator("body"), `${path} boş olmamalı`).toBeVisible();

  if (typeof ready === "string" || ready instanceof RegExp) {
    await expect(page.getByRole("heading", { name: ready }).first()).toBeVisible();
  } else {
    await expect(ready).toBeVisible();
  }

  await page.waitForLoadState("load");
  await expect(page.locator("html[data-mrap-hydrated='true']"), `${path} istemci etkileşimine hazır olmalı`).toHaveCount(1, { timeout: 20_000 });
  await page.evaluate(async () => {
    if ("fonts" in document) await document.fonts.ready;
  });
  return response;
}

export async function expectNoHorizontalOverflow(page: Page, context: string) {
  const dimensions = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const viewportWidth = root.clientWidth;
    const scrollWidth = Math.max(root.scrollWidth, body?.scrollWidth ?? 0);
    return { viewportWidth, scrollWidth };
  });

  expect(
    dimensions.scrollWidth,
    `${context}: sayfa genişliği ${dimensions.scrollWidth}px, görünüm alanı ${dimensions.viewportWidth}px`,
  ).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

export async function assertRouteHealth(page: Page, path: string, ready: RegExp | string) {
  const health = watchBrowserFailures(page);
  await openRoute(page, path, ready);
  await expectNoHorizontalOverflow(page, path);
  await health.assertClean();
}
