const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function optimizeImage(file: File, options: { maxBytes?: number; maxDimension?: number } = {}) {
  const maxBytes = options.maxBytes ?? 400_000;
  const initialMaxDimension = options.maxDimension ?? 1_600;
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) throw new Error("Fotoğraf JPG, PNG veya WEBP olmalı.");
  if (file.size > 8_000_000) throw new Error("Fotoğraf dosyası en fazla 8 MB olabilir.");

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    let dimension = initialMaxDimension;
    let quality = 0.84;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const scale = Math.min(1, dimension / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Fotoğraf işlenemedi.");
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) throw new Error("Fotoğraf işlenemedi.");
      if (blob.size <= maxBytes || attempt === 8) return await blobToDataUrl(blob);
      if (quality > 0.58) quality -= 0.08;
      else dimension = Math.max(720, Math.round(dimension * 0.82));
    }
    throw new Error("Fotoğraf küçültülemedi.");
  } finally {
    bitmap.close();
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Fotoğraf okunamadı."));
    reader.readAsDataURL(blob);
  });
}
