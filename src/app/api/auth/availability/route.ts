import { getCurrentUser } from "@/lib/auth";
import { findUserRowByEmail, findUserRowByUsername } from "@/lib/repository";
import { isValidEmail, isValidUsername, normalizeEmail, normalizeUsername } from "@/lib/validation";
import { API_BODY_BYTE_LIMITS, API_RATE_LIMITS, noStoreJson, requestBodyErrorResponse } from "@/server/http/api-security";
import { readLimitedJsonObject } from "@/server/http/limited-json";
import { checkRateLimit } from "@/server/http/rate-limit";

export async function POST(request: Request) {
  const policy = API_RATE_LIMITS.authAvailability;
  const limited = await checkRateLimit(request, "auth-availability", policy.limit, policy.windowMs);
  if (limited) return limited;
  try {
    const body = await readLimitedJsonObject(request, API_BODY_BYTE_LIMITS.authAvailability);
    const field = body.field;
    if (field !== "email" && field !== "username") {
      return noStoreJson({ error: "Kontrol alanı geçersiz." }, { status: 400 });
    }

    const value = String(body.value ?? "");
    const normalized = field === "email" ? normalizeEmail(value) : normalizeUsername(value);
    const valid = field === "email" ? isValidEmail(normalized) : isValidUsername(normalized);
    if (!valid) return noStoreJson({ field, valid: false, available: false });

    const currentUser = await getCurrentUser();
    const owner = await (field === "email" ? findUserRowByEmail(normalized) : findUserRowByUsername(normalized));
    const available = !owner || owner.id === currentUser?.id;

    // Kayıt UX'i için yalnızca exact uygunluk sonucu döner; hesap/profile detayı açığa çıkarılmaz.
    return noStoreJson({ field, valid: true, available });
  } catch (error) {
    const response = requestBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
