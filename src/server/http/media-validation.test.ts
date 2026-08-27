import { describe, expect, it } from "vitest";
import { areSafeImageDataUrls, isSafeImageDataUrl, sanitizeImageDataUrl } from "@/server/http/media-validation";
import { jpegDataUrl, pngDataUrl } from "@/test/image-fixtures";

const jpegOnly = new Set(["image/jpeg"] as const);
const snapshotTypes = new Set(["image/jpeg", "image/png"] as const);

describe("güvenli görsel data URL doğrulaması", () => {
  it("MIME ile eşleşen JPEG ve PNG imzalarını kabul eder", () => {
    expect(isSafeImageDataUrl(jpegDataUrl(), { allowedMimeTypes: jpegOnly, maxDataUrlLength: 200 })).toBe(true);
    expect(isSafeImageDataUrl(pngDataUrl(), { allowedMimeTypes: snapshotTypes, maxDataUrlLength: 200 })).toBe(true);
  });

  it("sahte MIME, bozuk base64 ve boyut aşımını reddeder", () => {
    expect(isSafeImageDataUrl(jpegDataUrl().replace("image/jpeg", "image/png"), { allowedMimeTypes: snapshotTypes, maxDataUrlLength: 200 })).toBe(false);
    expect(isSafeImageDataUrl("data:image/jpeg;base64,not_base64", { allowedMimeTypes: jpegOnly, maxDataUrlLength: 100 })).toBe(false);
    expect(isSafeImageDataUrl(jpegDataUrl(), { allowedMimeTypes: jpegOnly, maxDataUrlLength: 20 })).toBe(false);
  });

  it("aşırı piksel ve en-boy oranı bildiren decoder-bomb görsellerini reddeder", () => {
    expect(isSafeImageDataUrl(pngDataUrl(8_192, 8_192), { allowedMimeTypes: snapshotTypes, maxDataUrlLength: 500 })).toBe(false);
    expect(isSafeImageDataUrl(jpegDataUrl(65_535, 1), { allowedMimeTypes: jpegOnly, maxDataUrlLength: 500 })).toBe(false);
    expect(isSafeImageDataUrl(pngDataUrl(101, 1), {
      allowedMimeTypes: snapshotTypes,
      maxDataUrlLength: 500,
      maxWidth: 1_000,
      maxHeight: 1_000,
      maxPixels: 1_000_000,
      maxAspectRatio: 50,
    })).toBe(false);
  });
});

describe("görsel listesi doğrulaması", () => {
  const jpeg = jpegDataUrl();
  const options = {
    allowedMimeTypes: jpegOnly,
    maxCount: 2,
    maxDataUrlLength: 100,
    maxTotalDataUrlLength: jpeg.length * 2,
  };

  it("adet ve toplam boyut sınırları içindeki listeyi kabul eder", () => {
    expect(areSafeImageDataUrls([jpeg, jpeg], options)).toBe(true);
  });

  it("fazla adedi ve toplam boyutu reddeder", () => {
    expect(areSafeImageDataUrls([jpeg, jpeg, jpeg], options)).toBe(false);
    expect(areSafeImageDataUrls([jpeg, jpeg], { ...options, maxTotalDataUrlLength: jpeg.length * 2 - 1 })).toBe(false);
  });
});

describe("sunucu tarafı metadata redaksiyonu", () => {
  it("JPEG EXIF uygulama segmentini kalıcı veriden çıkarır", () => {
    const exif = Buffer.from("Exif\0\0GPSLatitude=41.0082;GPSLongitude=28.9784", "ascii");
    const length = Buffer.alloc(2);
    length.writeUInt16BE(exif.length + 2);
    const crafted = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
      length,
      exif,
      Buffer.from(jpegDataUrl().split(",")[1], "base64").subarray(2, -2),
      Buffer.from([0xff, 0xd9]),
    ]);
    const sanitized = sanitizeImageDataUrl(`data:image/jpeg;base64,${crafted.toString("base64")}`, {
      allowedMimeTypes: jpegOnly,
      maxDataUrlLength: 1_000,
    });

    expect(sanitized).not.toBeNull();
    expect(Buffer.from(sanitized!.split(",")[1], "base64").toString("ascii")).not.toContain("GPS");
  });

  it("EOI sonrasına gizlenmiş JPEG verisini reddeder", () => {
    const crafted = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.from("GPS=41,29")]);
    expect(sanitizeImageDataUrl(`data:image/jpeg;base64,${crafted.toString("base64")}`, {
      allowedMimeTypes: jpegOnly,
      maxDataUrlLength: 1_000,
    })).toBeNull();
  });
});
