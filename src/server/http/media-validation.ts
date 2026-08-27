type SupportedImageMime = "image/jpeg" | "image/png";

type ImageValidationOptions = {
  allowedMimeTypes: ReadonlySet<SupportedImageMime>;
  maxDataUrlLength: number;
  /** Decoder-bomb limits. Callers may tighten these, but cannot bypass validation. */
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  maxAspectRatio?: number;
};

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;
const DEFAULT_IMAGE_LIMITS = {
  // Client uploads are normalized to 1600px. This margin keeps valid map
  // captures while bounding worst-case decoded RGBA memory per image.
  maxWidth: 2_560,
  maxHeight: 2_560,
  maxPixels: 6_553_600,
  maxAspectRatio: 12,
} as const;

type ImageDimensions = { width: number; height: number };

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function readJpegDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return null;

    const segmentLength = bytes.readUInt16BE(offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) return null;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset = segmentEnd;
  }

  return null;
}

function readPngDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 33) return null;
  if (bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function isWithinDimensionLimits(dimensions: ImageDimensions, options: ImageValidationOptions) {
  const maxWidth = options.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth;
  const maxHeight = options.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight;
  const maxPixels = options.maxPixels ?? DEFAULT_IMAGE_LIMITS.maxPixels;
  const maxAspectRatio = options.maxAspectRatio ?? DEFAULT_IMAGE_LIMITS.maxAspectRatio;
  const { width, height } = dimensions;
  if (width > maxWidth || height > maxHeight || width * height > maxPixels) return false;
  return Math.max(width, height) / Math.min(width, height) <= maxAspectRatio;
}

function hasExpectedSignature(mimeType: SupportedImageMime, bytes: Buffer) {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 4
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;
  }
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function decodeImageDataUrl(value: string, options: ImageValidationOptions) {
  if (!value || value.length > options.maxDataUrlLength) return null;
  const match = DATA_URL_PATTERN.exec(value);
  if (!match) return null;
  const mimeType = match[1] as SupportedImageMime;
  if (!options.allowedMimeTypes.has(mimeType)) return null;
  const payload = match[2];
  if (payload.length % 4 !== 0) return null;

  const bytes = Buffer.from(payload, "base64");
  if (!bytes.length) return null;
  const canonicalPayload = bytes.toString("base64").replace(/=+$/, "");
  if (canonicalPayload !== payload.replace(/=+$/, "")) return null;
  if (!hasExpectedSignature(mimeType, bytes)) return null;
  const dimensions = mimeType === "image/jpeg" ? readJpegDimensions(bytes) : readPngDimensions(bytes);
  if (!dimensions || !isWithinDimensionLimits(dimensions, options)) return null;
  return { mimeType, bytes, dimensions };
}

function hasPrefix(bytes: Buffer, offset: number, prefix: string) {
  return bytes.subarray(offset, offset + prefix.length).toString("ascii") === prefix;
}

/** Remove EXIF/XMP/IPTC/comment application segments before persistence. */
function stripJpegMetadata(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const chunks: Buffer[] = [bytes.subarray(0, 2)];
  let offset = 2;
  let complete = false;

  while (offset < bytes.length) {
    const markerStart = offset;
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9) {
      if (offset !== bytes.length) return null;
      chunks.push(Buffer.from([0xff, 0xd9]));
      complete = true;
      break;
    }

    // Start of scan: metadata segments have already been handled. Compressed
    // bytes are preserved exactly, but trailing data after EOI is rejected.
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) return null;
      const segmentLength = bytes.readUInt16BE(offset);
      const segmentEnd = offset + segmentLength;
      if (segmentLength < 2 || segmentEnd > bytes.length) return null;
      if (bytes.length < 2 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
      chunks.push(bytes.subarray(markerStart));
      complete = true;
      break;
    }

    // Standalone markers do not carry a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      chunks.push(bytes.subarray(markerStart, offset));
      continue;
    }

    if (offset + 2 > bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) return null;

    const payloadOffset = offset + 2;
    const isApplicationSegment = marker >= 0xe0 && marker <= 0xef;
    const safeJfif = marker === 0xe0 && (hasPrefix(bytes, payloadOffset, "JFIF\0") || hasPrefix(bytes, payloadOffset, "JFXX\0"));
    const safeAdobeColorMarker = marker === 0xee && hasPrefix(bytes, payloadOffset, "Adobe");
    const shouldStrip = marker === 0xfe || (isApplicationSegment && !safeJfif && !safeAdobeColorMarker);
    if (!shouldStrip) chunks.push(bytes.subarray(markerStart, segmentEnd));
    offset = segmentEnd;
  }

  return complete ? Buffer.concat(chunks) : null;
}

const PNG_METADATA_CHUNKS = new Set(["eXIf", "iTXt", "tEXt", "zTXt", "tIME"]);

/** Remove standard PNG metadata chunks while keeping rendered pixels intact. */
function stripPngMetadata(bytes: Buffer) {
  const chunks: Buffer[] = [bytes.subarray(0, 8)];
  let offset = 8;
  let firstChunk = true;
  let complete = false;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return null;
    const dataLength = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + dataLength;
    if (chunkEnd > bytes.length) return null;
    const chunkType = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (firstChunk && chunkType !== "IHDR") return null;
    firstChunk = false;
    if (!PNG_METADATA_CHUNKS.has(chunkType)) chunks.push(bytes.subarray(offset, chunkEnd));
    offset = chunkEnd;
    if (chunkType === "IEND") {
      if (dataLength !== 0 || offset !== bytes.length) return null;
      complete = true;
      break;
    }
  }

  return complete ? Buffer.concat(chunks) : null;
}

export function isSafeImageDataUrl(
  value: string,
  options: ImageValidationOptions,
) {
  return Boolean(decodeImageDataUrl(value, options));
}

export function validateImageDataUrl(
  value: string,
  options: ImageValidationOptions,
) {
  return isSafeImageDataUrl(value, options);
}

/**
 * Returns a canonical, metadata-redacted data URL. Call this at the trusted
 * persistence boundary; validation alone must never be treated as EXIF removal.
 */
export function sanitizeImageDataUrl(value: string, options: ImageValidationOptions): string | null {
  const decoded = decodeImageDataUrl(value, options);
  if (!decoded) return null;
  const sanitized = decoded.mimeType === "image/jpeg"
    ? stripJpegMetadata(decoded.bytes)
    : stripPngMetadata(decoded.bytes);
  if (!sanitized) return null;
  return `data:${decoded.mimeType};base64,${sanitized.toString("base64")}`;
}

/**
 * Trusted storage adapters need the already-sanitized bytes and dimensions,
 * not a second ad-hoc parser. The returned buffer has metadata removed.
 */
export function decodeSanitizedImageDataUrl(value: string, options: ImageValidationOptions) {
  const canonical = sanitizeImageDataUrl(value, options);
  if (!canonical) return null;
  const decoded = decodeImageDataUrl(canonical, options);
  return decoded ? { ...decoded, canonical } : null;
}

export function sanitizeImageDataUrls(
  values: readonly string[],
  options: {
    allowedMimeTypes: ReadonlySet<SupportedImageMime>;
    maxCount: number;
    maxDataUrlLength: number;
    maxTotalDataUrlLength: number;
  },
): string[] | null {
  if (values.length > options.maxCount) return null;
  let totalLength = 0;
  const sanitized: string[] = [];
  for (const value of values) {
    totalLength += value.length;
    if (totalLength > options.maxTotalDataUrlLength) return null;
    const image = sanitizeImageDataUrl(value, options);
    if (!image) return null;
    sanitized.push(image);
  }
  return sanitized;
}

export function areSafeImageDataUrls(
  values: readonly string[],
  options: {
    allowedMimeTypes: ReadonlySet<SupportedImageMime>;
    maxCount: number;
    maxDataUrlLength: number;
    maxTotalDataUrlLength: number;
  },
) {
  if (values.length > options.maxCount) return false;
  let totalLength = 0;
  for (const value of values) {
    totalLength += value.length;
    if (totalLength > options.maxTotalDataUrlLength) return false;
    if (!isSafeImageDataUrl(value, options)) return false;
  }
  return true;
}
