import { getCurrentUser } from "@/lib/auth";
import { getUserCoverData } from "@/lib/repository";
import { noStoreJson, PROFILE_IMAGE_DATA_URL_MAX_LENGTH } from "@/server/http/api-security";
import { decodeValidatedJpegDataUrl, privateJpegResponse } from "@/server/http/image-response";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getCurrentUser()) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return noStoreJson({ error: "Kullanıcı kimliği geçersiz." }, { status: 400 });
  const dataUrl = await getUserCoverData(id);
  if (!dataUrl) return noStoreJson({ error: "Kapak fotoğrafı bulunamadı." }, { status: 404 });
  const bytes = decodeValidatedJpegDataUrl(dataUrl, PROFILE_IMAGE_DATA_URL_MAX_LENGTH);
  return bytes
    ? privateJpegResponse(bytes)
    : noStoreJson({ error: "Kapak fotoğrafı verisi geçersiz." }, { status: 422 });
}
