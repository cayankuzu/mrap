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

  it("GPS hareket yönünü yalnız istemci konum örneğine ekler", () => {
    const onLocation = vi.fn();
    const watchPosition = vi.fn((onSuccess: PositionCallback) => {
      onSuccess({
        coords: { longitude: 29, latitude: 41, accuracy: 6, heading: 92 },
        timestamp: 1_000,
      } as GeolocationPosition);
      return 7;
    });
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch: vi.fn() } });

    new RealLocationProvider().start(onLocation, vi.fn());

    expect(onLocation).toHaveBeenCalledWith(expect.objectContaining({ headingDeg: 92 }));
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

  it("simülasyon hareketinin baktığı yönü kuzey referanslı üretir", () => {
    const onLocation = vi.fn();
    const provider = new SimulatedLocationProvider([29, 41]);
    provider.start(onLocation);
    provider.move(1, 0, 5);
    provider.move(0, -1, 5);

    expect(onLocation.mock.calls.at(-2)?.[0]).toEqual(expect.objectContaining({ headingDeg: 90 }));
    expect(onLocation.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ headingDeg: 180 }));
  });
});
