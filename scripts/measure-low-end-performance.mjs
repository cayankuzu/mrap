import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = (process.env.MRAP_PERF_URL ?? "http://127.0.0.1:3300").replace(/\/$/, "");
const runCount = Math.max(1, Number.parseInt(process.env.MRAP_PERF_RUNS ?? "5", 10) || 5);
const outputPath = resolve(process.env.MRAP_PERF_OUTPUT ?? "artifacts/performance/low-end-mobile.json");
const routePaths = ["/demo/home", "/demo/explore", "/demo/play"];
const network = {
  offline: false,
  latency: 150,
  downloadThroughput: 200_000,
  uploadThroughput: 93_750,
  connectionType: "cellular4g",
};

function percentile(values, ratio) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

function summarize(samples, key) {
  const values = samples.map((sample) => sample[key]).filter(Number.isFinite);
  return { median: percentile(values, 0.5), p75: percentile(values, 0.75), max: values.length ? Math.max(...values) : null };
}

async function configureLowEndProfile(page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await session.send("Network.emulateNetworkConditions", network);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  return session;
}

async function measureColdRoute(browser, path) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const session = await configureLowEndProfile(page);
  const requests = new Set();
  const scriptRequests = new Set();
  let javascriptBytes = 0;

  session.on("Network.responseReceived", ({ requestId, type }) => {
    requests.add(requestId);
    if (type === "Script") scriptRequests.add(requestId);
  });
  session.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
    if (scriptRequests.has(requestId)) javascriptBytes += encodedDataLength;
  });
  await page.addInitScript(() => {
    window.__mrapPerformance = { lcp: 0, cls: 0, longTasks: [] };
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries.at(-1);
      if (last) window.__mrapPerformance.lcp = last.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__mrapPerformance.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__mrapPerformance.longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });

  const startedAt = Date.now();
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(3_500);
  const timing = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const firstPaint = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      fcpMs: firstPaint?.startTime ?? null,
      ttfbMs: navigation ? navigation.responseStart - navigation.requestStart : null,
      lcpMs: window.__mrapPerformance?.lcp || null,
      cls: window.__mrapPerformance?.cls ?? null,
      longTasksMs: window.__mrapPerformance?.longTasks ?? [],
    };
  });
  const result = {
    path,
    ...timing,
    loadWindowMs: Date.now() - startedAt,
    javascriptBytes: Math.round(javascriptBytes),
    requests: requests.size,
  };
  await session.detach();
  await context.close();
  return result;
}

async function measureWarmNavigation(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const session = await configureLowEndProfile(page);
  await page.goto(`${baseUrl}/demo/home`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(".bottom-nav").waitFor({ state: "visible" });
  await page.waitForTimeout(2_000);
  const targets = ["explore", "play", "leaderboard", "profile", "home"];
  const samples = [];
  for (const target of targets) {
    const href = `/demo/${target}`;
    const link = page.locator(`.bottom-nav a[href="${href}"]`);
    const startedAt = Date.now();
    const feedbackMs = await link.evaluate((element) => new Promise((resolve) => {
      const started = performance.now();
      const observer = new MutationObserver(() => {
        if (!element.classList.contains("is-active")) return;
        observer.disconnect();
        resolve(performance.now() - started);
      });
      observer.observe(element, { attributes: true, attributeFilter: ["class"] });
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0, pointerType: "touch" }));
      element.click();
      if (element.classList.contains("is-active")) {
        observer.disconnect();
        resolve(performance.now() - started);
      }
    }));
    await page.waitForURL((url) => url.pathname === href, { timeout: 30_000 });
    samples.push({ href, feedbackMs, routeCommitMs: Date.now() - startedAt });
    await page.waitForTimeout(250);
  }
  await session.detach();
  await context.close();
  return samples;
}

const browser = await chromium.launch();
try {
  const cold = {};
  for (const path of routePaths) {
    cold[path] = [];
    for (let run = 0; run < runCount; run += 1) cold[path].push(await measureColdRoute(browser, path));
  }
  const warm = await measureWarmNavigation(browser);
  const report = {
    generatedAt: new Date().toISOString(),
    target: baseUrl,
    profile: { viewport: "390x844", cpuThrottle: 6, network: "Slow 4G", runCount },
    cold,
    summary: Object.fromEntries(Object.entries(cold).map(([path, samples]) => [path, {
      fcpMs: summarize(samples, "fcpMs"),
      lcpMs: summarize(samples, "lcpMs"),
      ttfbMs: summarize(samples, "ttfbMs"),
      cls: summarize(samples, "cls"),
      javascriptBytes: summarize(samples, "javascriptBytes"),
      requestCount: summarize(samples, "requests"),
      longestTaskMs: {
        median: percentile(samples.map((sample) => Math.max(0, ...sample.longTasksMs)), 0.5),
        p75: percentile(samples.map((sample) => Math.max(0, ...sample.longTasksMs)), 0.75),
      },
    }])),
    warm,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
  process.stdout.write(`Rapor: ${outputPath}\n`);
} finally {
  await browser.close();
}
