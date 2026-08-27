import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_MOBILE_PORT ?? 3200);
const baseURL = process.env.PLAYWRIGHT_MOBILE_BASE_URL ?? `http://localhost:${port}`;
const runSeed = (process.pid + Date.now()) >>> 0;

const mobileViewports = [
  { name: "mobile-320x568", width: 320, height: 568 },
  { name: "mobile-360x800", width: 360, height: 800 },
  { name: "mobile-375x812", width: 375, height: 812 },
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "mobile-393x852", width: 393, height: 852 },
  { name: "mobile-412x915", width: 412, height: 915 },
  { name: "mobile-430x932", width: 430, height: 932 },
  { name: "mobile-480x800", width: 480, height: 800 },
] as const;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /mobile-audit\.spec\.ts/,
  outputDir: "./test-results/mobile-playwright-artifacts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 2,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["dot"], ["html", { outputFolder: "playwright-report/mobile", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report/mobile", open: "never" }]],
  use: {
    baseURL,
    browserName: "chromium",
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    colorScheme: "light",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent: "Mozilla/5.0 (Linux; Android 15; mrap-mobile-audit) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      MRAP_SQLITE_FILENAME: "mrap-playwright-mobile.sqlite",
      MRAP_RATE_LIMIT_NAMESPACE: `playwright-mobile-${runSeed}`,
    },
  },
  projects: mobileViewports.map(({ name, width, height }) => ({
    name,
    use: {
      viewport: { width, height },
      screen: { width, height },
    },
  })),
});
