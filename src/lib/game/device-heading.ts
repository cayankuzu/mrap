export type DeviceHeadingPermission = "granted" | "denied" | "unsupported";

type SafariDeviceOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number | null;
};

type DeviceOrientationEventConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: (absolute?: boolean) => Promise<PermissionState>;
};

export function normalizeHeading(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return ((value % 360) + 360) % 360;
}

const CARDINAL_DIRECTIONS = ["Kuzey", "Kuzeydoğu", "Doğu", "Güneydoğu", "Güney", "Güneybatı", "Batı", "Kuzeybatı"] as const;

export function headingCardinalLabel(value: number) {
  const normalized = normalizeHeading(value);
  return normalized === null ? "Belirsiz" : CARDINAL_DIRECTIONS[Math.round(normalized / 45) % CARDINAL_DIRECTIONS.length];
}

export function headingDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

export function smoothHeading(previous: number | null, next: number, weight = 0.28) {
  const normalizedNext = normalizeHeading(next);
  if (normalizedNext === null) return previous;
  if (previous === null) return normalizedNext;
  const safeWeight = Math.min(1, Math.max(0, weight));
  return normalizeHeading(previous + headingDelta(previous, normalizedNext) * safeWeight);
}

export function headingFromOrientation(event: DeviceOrientationEvent) {
  const safariHeading = normalizeHeading((event as SafariDeviceOrientationEvent).webkitCompassHeading);
  if (safariHeading !== null) return safariHeading;
  if (!event.absolute) return null;
  const alpha = normalizeHeading(event.alpha);
  return alpha === null ? null : normalizeHeading(360 - alpha);
}

export function headingFromGeolocation(position: GeolocationPosition) {
  return normalizeHeading(position.coords.heading);
}

export function deviceHeadingRequiresPermission() {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return false;
  const constructor = window.DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission;
  return typeof constructor.requestPermission === "function";
}

export async function requestDeviceHeadingPermission(): Promise<DeviceHeadingPermission> {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return "unsupported";
  const constructor = window.DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission;
  if (typeof constructor.requestPermission !== "function") return "granted";
  try {
    return await constructor.requestPermission(true) === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

export function subscribeDeviceHeading(onHeading: (heading: number) => void) {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return () => undefined;
  const handleOrientation = (event: Event) => {
    const heading = headingFromOrientation(event as DeviceOrientationEvent);
    if (heading !== null) onHeading(heading);
  };
  window.addEventListener("deviceorientationabsolute", handleOrientation, { passive: true });
  window.addEventListener("deviceorientation", handleOrientation, { passive: true });
  return () => {
    window.removeEventListener("deviceorientationabsolute", handleOrientation);
    window.removeEventListener("deviceorientation", handleOrientation);
  };
}
