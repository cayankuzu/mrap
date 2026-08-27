import "server-only";

import { MEDIA_LIMITS } from "@/lib/content-limits";
import { RequestBodyError } from "@/server/http/limited-json";
import { checkRateLimit } from "@/server/http/rate-limit";

export type RateLimitPolicy = Readonly<{ limit: number; windowMs: number }>;

export const PROFILE_IMAGE_DATA_URL_MAX_LENGTH = 650_000;

export const API_BODY_BYTE_LIMITS = Object.freeze({
  authAvailability: 1_024,
  authLogin: 1_024,
  authRegister: 4_096,
  authReset: 4_096,
  followRequestResolution: 512,
  socialMutation: 128,
  postCreate: MEDIA_LIMITS.postImages.maxTotalDataUrlLength
    + MEDIA_LIMITS.postMapSnapshot.maxDataUrlLength
    + 64 * 1_024,
  profileUpdate: PROFILE_IMAGE_DATA_URL_MAX_LENGTH * 2 + 32 * 1_024,
});

export const API_RATE_LIMITS = Object.freeze({
  authAvailability: { limit: 30, windowMs: 10 * 60 * 1_000 },
  authLogin: { limit: 10, windowMs: 15 * 60 * 1_000 },
  authRegister: { limit: 5, windowMs: 60 * 60 * 1_000 },
  authReset: { limit: 6, windowMs: 60 * 60 * 1_000 },
  followRequestResolution: { limit: 120, windowMs: 10 * 60 * 1_000 },
  followToggle: { limit: 120, windowMs: 10 * 60 * 1_000 },
  notificationRead: { limit: 120, windowMs: 10 * 60 * 1_000 },
  postCreate: { limit: 20, windowMs: 10 * 60 * 1_000 },
  postLike: { limit: 300, windowMs: 10 * 60 * 1_000 },
  postSave: { limit: 240, windowMs: 10 * 60 * 1_000 },
  profileUpdate: { limit: 30, windowMs: 10 * 60 * 1_000 },
} satisfies Record<string, RateLimitPolicy>);

export function noStoreJson(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  if (!headers.has("Vary")) headers.set("Vary", "Cookie");
  return Response.json(value, { ...init, headers });
}

export function requestBodyErrorResponse(error: unknown) {
  return error instanceof RequestBodyError
    ? noStoreJson({ error: error.message }, { status: error.status })
    : null;
}

export function checkUserMutationRateLimit(
  request: Request,
  userId: string,
  bucketName: string,
  policy: RateLimitPolicy,
) {
  return checkRateLimit(request, `${bucketName}:${userId}`, policy.limit, policy.windowMs);
}
