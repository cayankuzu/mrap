import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, openRoute, watchBrowserFailures } from "./support";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  colorScheme: "light",
  userAgent: "Mozilla/5.0 (Linux; Android 15; mrap-release-journey) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
});

test.skip(({ browserName }) => browserName !== "chromium", "Yerel SQLite sürüm yolculuğu tek, deterministik Chromium mobil bağlamında çalışır.");

type JourneyIdentity = {
  username: string;
  email: string;
  password: string;
};

async function installDeterministicGeolocation(page: Page) {
  await page.addInitScript(() => {
    type TestCoordinate = { latitude: number; longitude: number; accuracy: number };
    let current: TestCoordinate = { latitude: 40.987, longitude: 29.027, accuracy: 4 };
    let nextWatchId = 1;
    const watchers = new Map<number, PositionCallback>();
    const position = (): GeolocationPosition => ({
      coords: {
        accuracy: current.accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        latitude: current.latitude,
        longitude: current.longitude,
        speed: null,
        toJSON: () => ({ ...current }),
      },
      timestamp: Date.now(),
      toJSON: () => ({ coords: { ...current }, timestamp: Date.now() }),
    });
    const geolocation: Geolocation = {
      getCurrentPosition(success) {
        window.setTimeout(() => success(position()), 0);
      },
      watchPosition(success) {
        const id = nextWatchId++;
        watchers.set(id, success);
        window.setTimeout(() => watchers.get(id)?.(position()), 0);
        return id;
      },
      clearWatch(id) {
        watchers.delete(id);
      },
    };
    Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: geolocation });
    Object.defineProperty(window, "__mrapSetTestGeolocation", {
      configurable: true,
      value: (coordinate: TestCoordinate) => {
        current = coordinate;
        for (const notify of watchers.values()) notify(position());
      },
    });
  });
}

async function registerLocalAccount(page: Page, identity: JourneyIdentity) {
  await openRoute(page, "/register", /Şehrinde ilk alanını oluştur/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Ad soyad").fill("Mobil Yolcu");
  await page.getByLabel("Kullanıcı adı").fill(identity.username);
  await page.getByLabel("Doğum tarihi / yaş").fill("1995-05-17");
  await page.getByLabel("E-posta adresi").fill(identity.email);
  await page.getByLabel("Şifre", { exact: true }).fill(identity.password);
  await page.getByRole("checkbox", { name: /Kullanım koşullarını/ }).check();
  await expect(page.locator("#username-availability")).toContainText("Kullanıcı adı kullanılabilir.");
  await expect(page.locator("#email-availability")).toContainText("E-posta adresi kullanılabilir.");
  const submit = page.getByRole("button", { name: "Hesap oluştur" });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();
  await page.waitForURL(/\/home$/, { timeout: 20_000 });
}

async function closeServerValidatedLoopAwayFromStart(page: Page) {
  await openRoute(page, "/play", /Stratejik rotanı başlat/);
  const sessionCard = page.locator(".game-session-card");
  const locationPanelButton = page.getByRole("button", { name: /Konum test panelini aç|WASD \/ yön tuşları panelini aç/ });
  await expect(locationPanelButton).toBeVisible();
  await locationPanelButton.click();
  const developerPanel = page.getByRole("complementary", { name: "Konum test paneli" });
  await expect(developerPanel).toBeVisible();
  await developerPanel.getByRole("button", { name: "Sanal konum" }).click();
  await expect(developerPanel).toContainText("Sanal konum hazır");
  await developerPanel.getByRole("button", { name: "Paneli kapat" }).click();

  const start = sessionCard.getByRole("button", { name: "Harekete geç" });
  await expect(start).toBeEnabled({ timeout: 20_000 });
  await start.click();
  await expect(page.getByText("Rota güvenle kaydediliyor", { exact: true })).toBeVisible({ timeout: 20_000 });

  // Başlangıç (0,0) değildir: son batı hareketi, ilk kuzey segmentine
  // yaklaşık (0,50) noktasında temas ederek C-D-E-C döngüsünü kapatır.
  const route = ["w", "w", "w", "w", "d", "d", "d", "d", "s", "s", "a", "a", "a", "a"];
  for (const key of route) {
    await page.keyboard.press(key);
    // Sunucu minimum nokta aralığı ve simülasyon hız doğrulamasını gerçekten uygulasın.
    await page.waitForTimeout(300);
  }

  const opportunity = page.getByRole("dialog", { name: "Yeni bir alan kapatabilirsin." });
  await expect(opportunity).toBeVisible({ timeout: 25_000 });
  await expect(opportunity).toContainText("Sunucu rotanı doğruladı");
  await opportunity.getByRole("button", { name: "Alanı Kapat" }).click();
  await expect(page.getByText("Alan güncellendi", { exact: true })).toBeVisible({ timeout: 30_000 });

  const finish = sessionCard.getByRole("button", { name: "Takibi bitir" });
  await expect(finish).toBeEnabled({ timeout: 15_000 });
  await finish.click();
  await expect(page.getByText("Oturum tamamlandı", { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function closePostableGeolocationLoopAwayFromStart(page: Page) {
  const sessionCard = page.locator(".game-session-card");
  await sessionCard.getByRole("button", { name: "Yeni oturum" }).click();
  const locationPanelButton = page.getByRole("button", { name: /Konum test panelini aç|WASD \/ yön tuşları panelini aç/ });
  await locationPanelButton.click();
  const developerPanel = page.getByRole("complementary", { name: "Konum test paneli" });
  await developerPanel.getByRole("button", { name: "Gerçek konum" }).click();
  await developerPanel.getByRole("button", { name: "Paneli kapat" }).click();

  const origin = { latitude: 40.987, longitude: 29.027, accuracy: 4 };
  await page.evaluate((coordinate) => {
    (window as typeof window & { __mrapSetTestGeolocation?: (value: typeof coordinate) => void }).__mrapSetTestGeolocation?.(coordinate);
  }, origin);
  await sessionCard.getByRole("button", { name: "Harekete geç" }).click();
  await expect(page.getByText("Rota güvenle kaydediliyor", { exact: true })).toBeVisible({ timeout: 20_000 });

  const metersPerLatitude = 110_540;
  const metersPerLongitude = 111_320 * Math.cos(origin.latitude * Math.PI / 180);
  let eastM = 0;
  let northM = 0;
  // Gerçek GPS toleransı 12 m: ikinci batı adımı ilk segmente yeterince yaklaşır.
  // Aday oluştuktan sonra ek nokta göndermemek, candidate endSequence kanıtını korur.
  const route = ["n", "n", "n", "n", "e", "e", "e", "e", "s", "s", "w", "w"] as const;
  for (const direction of route) {
    if (direction === "n") northM += 5;
    if (direction === "s") northM -= 5;
    if (direction === "e") eastM += 5;
    if (direction === "w") eastM -= 5;
    const coordinate = {
      latitude: origin.latitude + northM / metersPerLatitude,
      longitude: origin.longitude + eastM / metersPerLongitude,
      accuracy: 4,
    };
    await page.evaluate((value) => {
      (window as typeof window & { __mrapSetTestGeolocation?: (coordinate: typeof value) => void }).__mrapSetTestGeolocation?.(value);
    }, coordinate);
    // 5 metre / 650 ms ≈ 7,7 m/sn; gerçek GPS güvenlik eşiğinin altında.
    await page.waitForTimeout(650);
  }

  const opportunity = page.getByRole("dialog", { name: "Yeni bir alan kapatabilirsin." });
  await expect(opportunity).toBeVisible({ timeout: 30_000 });
  await expect(opportunity).toContainText("Sunucu rotanı doğruladı");
  await opportunity.getByRole("button", { name: "Alanı Kapat" }).click();
  await expect(page.getByText("Alan güncellendi", { exact: true })).toBeVisible({ timeout: 30_000 });
  await sessionCard.getByRole("button", { name: "Takibi bitir" }).click();
  await expect(page.getByText("Oturum tamamlandı", { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function publishClaimedTerritory(page: Page, title: string) {
  await openRoute(page, "/home", "Akışın");
  await page.getByRole("button", { name: /Alanını ölümsüzleştir/ }).click();
  const composer = page.getByRole("dialog", { name: "Alanını ölümsüzleştir" });
  await expect(composer).toBeVisible();
  await composer.getByPlaceholder("Rotana kısa bir başlık ver").fill(title);
  await composer.getByPlaceholder("Bu alanın hikâyesini anlat…").fill("Başlangıca dönmeden, aktif rotanın eski segmentine temas eden gerçek SQLite alan testi.");

  const territorySelect = composer.locator("#real-territory-select");
  await expect(territorySelect.locator("option")).toHaveCount(2, { timeout: 20_000 });
  await territorySelect.selectOption({ index: 1 });
  const frameEditor = composer.locator(".territory-frame-editor");
  await expect(frameEditor).toBeVisible({ timeout: 20_000 });
  const saveFrame = frameEditor.getByRole("button", { name: "Kadrajı kaydet" });
  await expect(saveFrame).toBeEnabled({ timeout: 20_000 });
  await saveFrame.click();
  await expect(frameEditor).toContainText("Kaydedildi", { timeout: 15_000 });

  const publish = composer.getByRole("button", { name: "Paylaş", exact: true });
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(composer).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("article.post-card").filter({ hasText: title })).toBeVisible({ timeout: 20_000 });
}

async function deleteJourneyAccount(page: Page, identity: JourneyIdentity) {
  return page.evaluate(async ({ username, email, password }) => {
    const deleteAccount = () => fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: username, acknowledged: true, password }),
    });
    let response = await deleteAccount();
    if (response.status === 401) {
      const login = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember: false }),
      });
      if (login.ok) response = await deleteAccount();
    }
    return { status: response.status, body: await response.text() };
  }, identity);
}

test("kayıttan paylaşıma gerçek mobil SQLite yolculuğu tamamlanır ve hesap temizlenir", async ({ page }, testInfo) => {
  test.setTimeout(210_000);
  const health = watchBrowserFailures(page);
  const suffix = `${process.pid.toString(36)}${Date.now().toString(36).slice(-7)}${testInfo.retry}`.slice(-15);
  const identity: JourneyIdentity = {
    username: `mobil_${suffix}`.slice(0, 20),
    email: `mobil-${suffix}@example.test`,
    password: "Guvenli12345",
  };
  const postTitle = `Başlangıca dönmeden ${suffix}`.slice(0, 80);
  let registered = false;

  try {
    await installDeterministicGeolocation(page);
    await registerLocalAccount(page, identity);
    registered = true;
    await closeServerValidatedLoopAwayFromStart(page);
    // Geliştirme dünyasındaki sanal claim rekabetçi/sosyal akışa bilerek taşınmaz.
    // Aynı özgür loop'u gerçek-konum sağlayıcısı arayüzüyle production world'de
    // doğrulayarak paylaşılabilir alan projeksiyonunu uçtan uca sınarız.
    await closePostableGeolocationLoopAwayFromStart(page);
    await publishClaimedTerritory(page, postTitle);

    await openRoute(page, "/profile", page.locator(".profile-identity h1"));
    await page.getByRole("tab", { name: /Gönderiler/ }).click();
    await expect(page.locator("article.post-card").filter({ hasText: postTitle })).toBeVisible();
    await expect(page.locator(".profile-stats-grid")).toContainText("1 başarılı kapatma");
    await expectNoHorizontalOverflow(page, "gerçek profil paylaşım doğrulaması");

    await openRoute(page, "/leaderboard", "Sıralama");
    const realScopes = page.getByRole("group", { name: "Sıralama kapsamı" }).getByRole("button");
    await expect(realScopes).toHaveCount(4);
    await expect(realScopes).toHaveText(["Arkadaşlar", "Şehir", "Ülke", "Dünya"]);
    await expect(realScopes.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByRole("searchbox", { name: "Sıralamada ara" })).toBeVisible();
    await expect(page.locator(".leaderboard-multiselect")).toHaveCount(1);
    await expect(page.getByText("Mahalle", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Dönem", { exact: true })).toHaveCount(0);
    const ownRank = page.locator(".podium-place.is-you, .real-rank-list article.is-you");
    await expect(ownRank).toContainText(identity.username);
    await expect(ownRank).toContainText("1 alan kapatma");
    await expectNoHorizontalOverflow(page, "gerçek sıralama doğrulaması");
    await health.assertClean();
  } finally {
    if (registered && !page.isClosed()) {
      const deletion = await deleteJourneyAccount(page, identity).catch((error) => ({ status: 0, body: String(error) }));
      expect.soft(deletion.status, `E2E hesabı ve ilişkili verileri temizlenmeli: ${deletion.body}`).toBe(200);
    }
  }
});
