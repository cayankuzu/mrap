import { getCurrentUser } from "@/lib/auth";
import { MEDIA_LIMITS } from "@/lib/content-limits";
import { getPostImageForViewer } from "@/lib/repository";
import { noStoreJson } from "@/server/http/api-security";
import { decodeValidatedJpegDataUrl, privateJpegResponse } from "@/server/http/image-response";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const { id, index: rawIndex } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return noStoreJson({ error: "Gönderi kimliği geçersiz." }, { status: 400 });
  if (!/^[0-5]$/.test(rawIndex)) return noStoreJson({ error: "Fotoğraf sırası geçersiz." }, { status: 400 });

  const dataUrl = await getPostImageForViewer(user.id, id, Number(rawIndex));
  if (!dataUrl) return noStoreJson({ error: "Fotoğraf bulunamadı." }, { status: 404 });
  const bytes = decodeValidatedJpegDataUrl(dataUrl, MEDIA_LIMITS.postImages.maxDataUrlLength);
  return bytes
    ? privateJpegResponse(bytes)
    : noStoreJson({ error: "Fotoğraf verisi geçersiz." }, { status: 422 });
}
