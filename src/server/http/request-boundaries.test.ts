import { describe, expect, it } from "vitest";
import { readLimitedJsonObject, RequestBodyError } from "@/server/http/limited-json";
import { areSafeImageDataUrls, isSafeImageDataUrl } from "@/server/http/media-validation";
import { jpegDataUrl, pngDataUrl } from "@/test/image-fixtures";

const jpegOnly = new Set(["image/jpeg"] as const);
const validJpeg = jpegDataUrl();
const validPng = pngDataUrl();

function jsonBody(raw: string) {
  return new Request("https://mrap.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

describe("limited JSON stream sınırları", () => {
  it("JSON content-type olsa bile eksik body'yi açık 400 hatasıyla reddeder", async () => {
    const incoming = new Request("https://mrap.test/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    await expect(readLimitedJsonObject(incoming, 100)).rejects.toMatchObject({
      name: "RequestBodyError",
      status: 400,
    } satisfies Partial<RequestBodyError>);
  });

  it("Content-Length olmadan stream üzerinden gelen gerçek byte aşımını iptal eder", async () => {
    await expect(readLimitedJsonObject(jsonBody(JSON.stringify({ value: "123456789" })), 5))
      .rejects.toMatchObject({ status: 413 });
  });

  it.each(["null", "[]", "\"yalnız string\""])('JSON nesnesi olmayan %s değerini reddeder', async (raw) => {
    await expect(readLimitedJsonObject(jsonBody(raw), 100)).rejects.toMatchObject({ status: 400 });
  });
});

describe("medya MIME ve canonical base64 sınırları", () => {
  const options = { allowedMimeTypes: jpegOnly, maxDataUrlLength: 1_000 };

  it("imzası geçerli olsa bile izin verilmeyen MIME türünü reddeder", () => {
    expect(isSafeImageDataUrl(validPng, options)).toBe(false);
  });

  it("dörde bölünmeyen ve canonical olmayan base64 payloadlarını reddeder", () => {
    expect(isSafeImageDataUrl("data:image/jpeg;base64,/9j", options)).toBe(false);
    expect(isSafeImageDataUrl("data:image/jpeg;base64,AB==", options)).toBe(false);
  });

  it("liste içinde sonraki bir görsel güvensizse tüm yüklemeyi reddeder", () => {
    expect(areSafeImageDataUrls([validJpeg, "data:image/jpeg;base64,AAAA"], {
      ...options,
      maxCount: 6,
      maxTotalDataUrlLength: 2_000,
    })).toBe(false);
  });
});
