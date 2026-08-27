import { test } from "./fixtures";
import { assertRouteHealth } from "./support";

test.skip(({ browserName }) => browserName !== "chromium", "Geniş rota matrisi Chromium üzerinde çalışır.");

const routes = [
  ["/", /Adımlarınla/],
  ["/login", /Haritana geri dön/],
  ["/register", /Şehrinde ilk alanını oluştur/],
  ["/forgot-password", /Şifreni yenile/],
  ["/privacy", /Konumunun kontrolü sende/],
  ["/terms", /Gerçek dünya önce güvenlik/],
  ["/help", /İlk alanını üç adımda kapat/],
  ["/demo/home", "Akışın"],
  ["/demo/explore", "Keşfet"],
  ["/demo/play", /Stratejik rotanı başlat/],
  ["/demo/leaderboard", "Sıralama"],
  ["/demo/profile", /.+/],
  ["/demo/notifications", "Bildirimler"],
  ["/demo/settings", "Ayarlar"],
] as const;

test.describe("Chromium kritik rota sağlık matrisi", () => {
  for (const [path, heading] of routes) {
    test(`${path} hatasız ve taşmasız açılır`, async ({ page }) => {
      await assertRouteHealth(page, path, heading);
    });
  }
});
