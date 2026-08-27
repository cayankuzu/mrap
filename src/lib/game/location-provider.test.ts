import { afterEach, describe, expect, it, vi } from "vitest";
import { RealLocationProvider, SimulatedLocationProvider } from "@/lib/game/location-provider";

afterEach(() => vi.unstubAllGlobals());

describe("konum sağlayıcı yaşam döngüsü", () => {
  it("gerçek GPS izleyicisini durdurma çağrısında temizler", () => {
    const clearWatch = vi.fn();
    const watchPosition = vi.fn().mockReturnValue(42);
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });
    const provider = new RealLocationProvider();

    const stop = provider.start(vi.fn(), vi.fn());
    expect(watchPosition).toHaveBeenCalledOnce();
    stop();
    expect(clearWatch).toHaveBeenCalledWith(42);
  });

  it("GPS desteklenmiyorsa açıklayıcı hata verir ve güvenli no-op stop döndürür", () => {
    vi.stubGlobal("navigator", {});
    const onError = vi.fn();
    const stop = new RealLocationProvider().start(vi.fn(), onError);
    expect(onError).toHaveBeenCalledWith("Bu tarayıcı konum özelliğini desteklemiyor.");
    expect(() => stop()).not.toThrow();
  });

  it("simülasyon stop sonrasında yeni koordinat yayınlamaz", () => {
    const onLocation = vi.fn();
    const provider = new SimulatedLocationProvider([29, 41]);
    const stop = provider.start(onLocation);
    expect(onLocation).toHaveBeenCalledOnce();
    stop();
    provider.move(1, 0, 5);
    expect(onLocation).toHaveBeenCalledOnce();
  });
});
