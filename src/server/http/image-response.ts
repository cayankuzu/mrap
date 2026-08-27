import { isSafeImageDataUrl } from "@/server/http/media-validation";

const jpegMimeTypes = new Set(["image/jpeg"] as const);

export function decodeValidatedJpegDataUrl(dataUrl: string, maxDataUrlLength: number) {
  if (!isSafeImageDataUrl(dataUrl, { allowedMimeTypes: jpegMimeTypes, maxDataUrlLength })) return null;
  const separator = dataUrl.indexOf(",");
  return Buffer.from(dataUrl.slice(separator + 1), "base64");
}

export function privateJpegResponse(bytes: Buffer) {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(bytes.byteLength),
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
