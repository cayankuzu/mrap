import { afterEach, describe, expect, it, vi } from "vitest";
import { headingCardinalLabel, headingDelta, headingFromGeolocation, headingFromOrientation, normalizeHeading, requestDeviceHeadingPermission, smoothHeading, subscribeDeviceHeading } from "@/lib/game/device-heading";

afterEach(() => vi.unstubAllGlobals());

describe("cihaz yönü geometrisi", () => {
  it("açıları kuzey referanslı 0-360 aralığına getirir", () => {
    expect(normalizeHeading(-10)).toBe(350);
    expect(normalizeHeading(725)).toBe(5);
    expect(normalizeHeading(Number.NaN)).toBeNull();
  });

  it("yönü Türkçe pusula etiketiyle açıklar", () => {
    expect(headingCardinalLabel(0)).toBe("Kuzey");
    expect(headingCardinalLabel(90)).toBe("Doğu");
    expect(headingCardinalLabel(225)).toBe("Güneybatı");
  });

  it("kuzey sınırını geçerken en kısa yönde yumuşatır", () => {
    expect(headingDelta(350, 10)).toBe(20);
    expect(smoothHeading(350, 10, 0.5)).toBe(0);
  });

  it("iOS pusula değerini standart mutlak alpha değerinden önce kullanır", () => {
    const event = { alpha: 40, absolute: false, webkitCompassHeading: 82 } as unknown as DeviceOrientationEvent;
    expect(headingFromOrientation(event)).toBe(82);
  });

  it("yalnızca mutlak standart yön olayını pusula yönüne dönüştürür", () => {
    expect(headingFromOrientation({ alpha: 40, absolute: true } as DeviceOrientationEvent)).toBe(320);
    expect(headingFromOrientation({ alpha: 40, absolute: false } as DeviceOrientationEvent)).toBeNull();
  });

  it("GPS heading değerini sensör yokken kullanılacak biçimde doğrular", () => {
    const position = { coords: { heading: 178 } } as GeolocationPosition;
    expect(headingFromGeolocation(position)).toBe(178);
    expect(headingFromGeolocation({ coords: { heading: null } } as GeolocationPosition)).toBeNull();
  });

  it("iOS tarzı izni mutlak yön için ister ve reddi güvenli fallback olarak döndürür", async () => {
    const requestPermission = vi.fn().mockResolvedValue("denied");
    vi.stubGlobal("window", { DeviceOrientationEvent: { requestPermission } });
    await expect(requestDeviceHeadingPermission()).resolves.toBe("denied");
    expect(requestPermission).toHaveBeenCalledWith(true);
  });

  it("desteklenmeyen cihazda sensör yerine GPS fallback yolunu açık bırakır", async () => {
    vi.stubGlobal("window", {});
    await expect(requestDeviceHeadingPermission()).resolves.toBe("unsupported");
  });

  it("yön dinleyicilerinin ikisini de durdururken temizler", () => {
    const listeners = new Map<string, EventListener>();
    const addEventListener = vi.fn((name: string, listener: EventListener) => listeners.set(name, listener));
    const removeEventListener = vi.fn((name: string) => listeners.delete(name));
    vi.stubGlobal("window", { DeviceOrientationEvent: {}, addEventListener, removeEventListener });
    const onHeading = vi.fn();
    const stop = subscribeDeviceHeading(onHeading);
    listeners.get("deviceorientationabsolute")?.({ alpha: 90, absolute: true } as unknown as Event);
    expect(onHeading).toHaveBeenCalledWith(270);
    stop();
    expect(removeEventListener).toHaveBeenCalledTimes(2);
    expect(listeners.size).toBe(0);
  });
});
