import { getCurrentUser } from "@/lib/auth";
import { normalizeRouteColor, resolveLocation } from "@/lib/app-config";
import { CONTENT_LIMITS } from "@/lib/content-limits";
import type { AppUser } from "@/lib/models";
import { findUserRowByUsername, updateUser, UserIdentityConflictError } from "@/lib/repository";
import { isValidUsername, normalizeUsername, parseIsoCalendarDate } from "@/lib/validation";
import { isEligibleBirthDate } from "@/lib/age-policy";
import { API_BODY_BYTE_LIMITS, API_RATE_LIMITS, PROFILE_IMAGE_DATA_URL_MAX_LENGTH, checkUserMutationRateLimit, noStoreJson, requestBodyErrorResponse } from "@/server/http/api-security";
import { readLimitedJsonObject } from "@/server/http/limited-json";
import { sanitizeImageDataUrl } from "@/server/http/media-validation";

const profileImageMimeTypes = new Set(["image/jpeg"] as const);

export async function GET() {
  const user = await getCurrentUser();
  return user ? noStoreJson({ user }) : noStoreJson({ error: "Yetkisiz." }, { status: 401 });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const limited = await checkUserMutationRateLimit(request, user.id, "profile-update", API_RATE_LIMITS.profileUpdate);
  if (limited) return limited;
  try {
    const body = await readLimitedJsonObject(request, API_BODY_BYTE_LIMITS.profileUpdate);
    const color = normalizeRouteColor(body.color ?? user.color);
    if (!color) return noStoreJson({ error: "Geçersiz renk." }, { status: 400 });
    const accountVisibility = String(body.accountVisibility ?? user.accountVisibility) as AppUser["accountVisibility"];
    if (!["public", "private"].includes(accountVisibility)) return noStoreJson({ error: "Geçersiz hesap görünürlüğü." }, { status: 400 });
    const displayName = String(body.displayName ?? user.displayName).trim();
    const username = normalizeUsername(String(body.username ?? user.username));
    const countryCode = String(body.countryCode ?? user.countryCode).trim().toUpperCase();
    const cityId = String(body.cityId ?? user.cityId).trim();
    const location = resolveLocation(countryCode, cityId);
    const bio = String(body.bio ?? user.bio).trim();
    const birthDate = String(body.birthDate ?? user.birthDate);
    const birth = parseIsoCalendarDate(birthDate);
    if (displayName.length < CONTENT_LIMITS.displayName.min || displayName.length > CONTENT_LIMITS.displayName.max) return noStoreJson({ error: "Ad soyad 2–60 karakter olmalı." }, { status: 400 });
    if (!isValidUsername(username)) return noStoreJson({ error: "Kullanıcı adı 3–20 karakter ve yalnızca harf, rakam veya _ içermeli." }, { status: 400 });
    const usernameOwner = await findUserRowByUsername(username);
    if (usernameOwner && usernameOwner.id !== user.id) return noStoreJson({ error: "Bu kullanıcı adı alınmış." }, { status: 409 });
    if (!location) return noStoreJson({ error: "Geçerli bir ülke ve şehir seç." }, { status: 400 });
    if (bio.length > CONTENT_LIMITS.bio.max) return noStoreJson({ error: "Biyografi 180 karakteri geçemez." }, { status: 400 });
    if (!birth || !isEligibleBirthDate(birthDate)) return noStoreJson({ error: "Geçerli bir doğum tarihi ve 13–100 yaş aralığı gerekli." }, { status: 400 });
    if ((body.avatarData !== undefined && body.avatarData !== null && typeof body.avatarData !== "string") || (body.coverData !== undefined && body.coverData !== null && typeof body.coverData !== "string")) {
      return noStoreJson({ error: "Profil görselleri geçersiz." }, { status: 400 });
    }
    const ownAvatarUrl = `/api/users/${encodeURIComponent(user.id)}/avatar`;
    const ownCoverUrl = `/api/users/${encodeURIComponent(user.id)}/cover`;
    const normalizeImage = (value: unknown, currentUrl: string) => {
      if (value === undefined || value === currentUrl) return { value: undefined } as const;
      if (value === null) return { value: null } as const;
      const sanitized = sanitizeImageDataUrl(String(value), { allowedMimeTypes: profileImageMimeTypes, maxDataUrlLength: PROFILE_IMAGE_DATA_URL_MAX_LENGTH });
      return sanitized ? { value: sanitized } as const : { error: true } as const;
    };
    const avatar = normalizeImage(body.avatarData, ownAvatarUrl);
    const cover = normalizeImage(body.coverData, ownCoverUrl);
    if ("error" in avatar || "error" in cover) {
      return noStoreJson({ error: "Profil görselleri güvenli yükleme sınırını aşıyor." }, { status: 400 });
    }
    try {
      const updated = await updateUser(user.id, {
        username,
        displayName,
        color,
        bio,
        countryCode,
        cityId,
        country: location.country,
        city: location.city,
        birthDate,
        accountVisibility,
        locationVisibility: "private",
        avatarData: avatar.value,
        coverData: cover.value,
      });
      return noStoreJson({ user: updated });
    } catch (error) {
      if (error instanceof UserIdentityConflictError) return noStoreJson({ error: "Bu kullanıcı adı alınmış." }, { status: 409 });
      throw error;
    }
  } catch (error) {
    const response = requestBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
