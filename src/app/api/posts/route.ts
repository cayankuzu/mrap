import { getCurrentUser } from "@/lib/auth";
import { CONTENT_LIMITS, MEDIA_LIMITS, POST_PAGE_LIMITS } from "@/lib/content-limits";
import { decodePostCursor } from "@/lib/post-cursor";
import { createPostRecord, listPostPage, listSavedPostPage, listUserPostPage } from "@/lib/repository";
import { resolvePostTitle } from "@/lib/validation";
import { API_BODY_BYTE_LIMITS, API_RATE_LIMITS, checkUserMutationRateLimit, noStoreJson, requestBodyErrorResponse } from "@/server/http/api-security";
import { readLimitedJsonObject } from "@/server/http/limited-json";
import { sanitizeImageDataUrl, sanitizeImageDataUrls } from "@/server/http/media-validation";
import { normalizeMapCamera } from "@/lib/map-preview";
import { IDEMPOTENCY_KEY_PATTERN, IdempotencyPayloadConflictError } from "@/lib/mutation-idempotency-store";

const postImageMimeTypes = new Set(["image/jpeg"] as const);
const mapSnapshotMimeTypes = new Set(["image/jpeg", "image/png"] as const);

function parseLimit(value: string | null) {
  if (value === null) return POST_PAGE_LIMITS.default;
  if (!/^\d{1,2}$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= POST_PAGE_LIMITS.max ? limit : null;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const searchParams = new URL(request.url).searchParams;
  const limit = parseLimit(searchParams.get("limit"));
  if (limit === null) return noStoreJson({ error: `Limit 1–${POST_PAGE_LIMITS.max} arasında olmalı.` }, { status: 400 });

  const encodedCursor = searchParams.get("cursor");
  const cursor = encodedCursor === null ? null : decodePostCursor(encodedCursor);
  if (encodedCursor !== null && !cursor) return noStoreJson({ error: "Gönderi imleci geçersiz." }, { status: 400 });

  const modeParam = searchParams.get("mode");
  if (modeParam === "saved") return noStoreJson(await listSavedPostPage(user.id, { cursor, limit }));
  if (modeParam === "user") {
    const ownerId = searchParams.get("ownerId") ?? "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) return noStoreJson({ error: "Profil sahibi geçersiz." }, { status: 400 });
    return noStoreJson(await listUserPostPage(user.id, ownerId, { cursor, limit }));
  }
  const mode = modeParam === "explore" || modeParam === "mine" ? modeParam : "following";
  return noStoreJson(await listPostPage(user.id, mode, { cursor, limit }));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const limited = await checkUserMutationRateLimit(request, user.id, "post-create", API_RATE_LIMITS.postCreate);
  if (limited) return limited;
  try {
    const body = await readLimitedJsonObject(request, API_BODY_BYTE_LIMITS.postCreate);
    const territoryId = String(body.territoryId ?? "");
    const idempotencyKey = body.idempotencyKey;
    if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return noStoreJson({ error: "Güvenli gönderim anahtarı geçersiz." }, { status: 400 });
    }
    const text = String(body.body ?? "").trim();
    if (body.title !== undefined && typeof body.title !== "string") return noStoreJson({ error: "Gönderi başlığı geçersiz." }, { status: 400 });
    const title = resolvePostTitle(body.title, text);
    if (body.images !== undefined && (!Array.isArray(body.images) || body.images.some((image) => typeof image !== "string"))) return noStoreJson({ error: "Fotoğraf listesi geçersiz." }, { status: 400 });
    const rawImages = (body.images ?? []) as string[];
    if (!territoryId) return noStoreJson({ error: "İlgili alan seçimi zorunlu." }, { status: 400 });
    if (title.length < CONTENT_LIMITS.postTitle.min || title.length > CONTENT_LIMITS.postTitle.max) return noStoreJson({ error: "Gönderi başlığı 1–80 karakter olmalı." }, { status: 400 });
    if (text.length > CONTENT_LIMITS.postBody.max) return noStoreJson({ error: "Paylaşım 500 karakteri geçemez." }, { status: 400 });
    if (rawImages.length > MEDIA_LIMITS.postImages.maxCount) return noStoreJson({ error: "En fazla 6 fotoğraf yükleyebilirsin." }, { status: 400 });
    const images = sanitizeImageDataUrls(rawImages, { allowedMimeTypes: postImageMimeTypes, ...MEDIA_LIMITS.postImages });
    if (!images) return noStoreJson({ error: "Fotoğraflar geçersiz veya güvenli yükleme sınırını aşıyor." }, { status: 400 });

    const rawMapSnapshot = body.mapSnapshot;
    let mapSnapshot: string | null = null;
    if (rawMapSnapshot !== undefined && rawMapSnapshot !== null && rawMapSnapshot !== "") {
      if (typeof rawMapSnapshot !== "string") {
        return noStoreJson({ error: "Harita görseli geçersiz veya güvenli yükleme sınırını aşıyor." }, { status: 400 });
      }
      mapSnapshot = sanitizeImageDataUrl(rawMapSnapshot, { allowedMimeTypes: mapSnapshotMimeTypes, maxDataUrlLength: MEDIA_LIMITS.postMapSnapshot.maxDataUrlLength });
      if (!mapSnapshot) return noStoreJson({ error: "Harita görseli geçersiz veya güvenli yükleme sınırını aşıyor." }, { status: 400 });
    }
    const mapView = body.mapView === undefined || body.mapView === null ? null : normalizeMapCamera(body.mapView);
    if (body.mapView !== undefined && body.mapView !== null && !mapView) return noStoreJson({ error: "Harita kadrajı geçersiz." }, { status: 400 });
    const id = await createPostRecord(user.id, {
      territoryId,
      title,
      body: text || "Yeni bir alanı şehre imzaladım.",
      images,
      mapSnapshot,
      mapView,
      idempotencyKey,
    });
    return id ? noStoreJson({ id, title }, { status: 201 }) : noStoreJson({ error: "Alan bulunamadı veya sana ait değil." }, { status: 403 });
  } catch (error) {
    if (error instanceof IdempotencyPayloadConflictError) {
      return noStoreJson({ error: error.message }, { status: 409 });
    }
    const response = requestBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
