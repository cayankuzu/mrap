import { createSession, hashPassword } from "@/lib/auth";
import { normalizeRouteColor, resolveLocation, ROUTE_COLORS } from "@/lib/app-config";
import { CONTENT_LIMITS } from "@/lib/content-limits";
import { createUser, findUserRowByEmail, findUserRowByUsername, UserIdentityConflictError } from "@/lib/repository";
import { API_BODY_BYTE_LIMITS, API_RATE_LIMITS, noStoreJson, requestBodyErrorResponse } from "@/server/http/api-security";
import { readLimitedJsonObject } from "@/server/http/limited-json";
import { checkRateLimit } from "@/server/http/rate-limit";
import { isValidEmail, isValidUsername, normalizeEmail, normalizeUsername, parseIsoCalendarDate } from "@/lib/validation";
import { isEligibleBirthDate } from "@/lib/age-policy";
import { hasCurrentLegalConsent } from "@/lib/legal-consent";
import { turnstileFailureStatus, verifyTurnstileMutation } from "@/features/security/turnstile/verify-turnstile";
import { EmailDeliveryUnavailableError, registerSupabaseAccount } from "@/lib/supabase/auth-operations";
import { supabaseProviderEnabled } from "@/lib/supabase/server-config";
import { resolvePublicOrigin } from "@/lib/public-origin";
import { resolveWorldLocation } from "@/lib/world-locations";

export async function POST(request: Request) {
  const policy = API_RATE_LIMITS.authRegister;
  const limited = await checkRateLimit(request, "auth-register", policy.limit, policy.windowMs);
  if (limited) return limited;
  try {
    const body = await readLimitedJsonObject(request, API_BODY_BYTE_LIMITS.authRegister);
    const displayName = String(body.displayName ?? "").trim();
    const email = normalizeEmail(String(body.email ?? ""));
    const username = normalizeUsername(String(body.username ?? ""));
    const password = String(body.password ?? "");
    const color = normalizeRouteColor(body.color ?? ROUTE_COLORS[0]);
    const birthDate = String(body.birthDate ?? "");
    const countryCode = String(body.countryCode ?? "").trim().toUpperCase();
    const cityId = String(body.cityId ?? "").trim();
    const legacyLocation = resolveLocation(countryCode, cityId);
    const worldLocation = legacyLocation ? null : await resolveWorldLocation(countryCode, cityId);
    const location = legacyLocation ?? worldLocation;
    const canonicalCityId = worldLocation?.cityId ?? cityId;
    const birth = parseIsoCalendarDate(birthDate);

    if (!hasCurrentLegalConsent(body)) return noStoreJson({ error: "Güncel kullanım koşulları ve gizlilik politikasını kabul etmelisin." }, { status: 400 });
    if (displayName.length < CONTENT_LIMITS.displayName.min || displayName.length > CONTENT_LIMITS.displayName.max) return noStoreJson({ error: "Ad soyad 2–60 karakter olmalı." }, { status: 400 });
    if (!isValidEmail(email)) return noStoreJson({ error: "Geçerli bir e-posta adresi yaz." }, { status: 400 });
    if (!isValidUsername(username)) return noStoreJson({ error: "Kullanıcı adı 3–20 karakter ve yalnızca harf, rakam veya _ içermeli." }, { status: 400 });
    if (password.length < CONTENT_LIMITS.password.min || password.length > CONTENT_LIMITS.password.max || !/[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(password) || !/\d/.test(password)) return noStoreJson({ error: "Şifre 8–128 karakter arasında, bir harf ve bir rakam içermeli." }, { status: 400 });
    if (!color) return noStoreJson({ error: "Geçersiz renk." }, { status: 400 });
    if (!location) return noStoreJson({ error: "Geçerli bir ülke ve şehir seç." }, { status: 400 });
    if (!birth || !isEligibleBirthDate(birthDate)) return noStoreJson({ error: "mrap hesabı için geçerli bir doğum tarihi ve 13–100 yaş aralığı gerekli." }, { status: 400 });
    const turnstile = await verifyTurnstileMutation({ token: body.turnstileToken, expectedAction: "register" });
    if (!turnstile.ok) {
      const status = turnstileFailureStatus(turnstile);
      return noStoreJson({
        error: status === 503
          ? "Güvenlik doğrulaması şu anda kullanılamıyor. Lütfen yeniden dene."
          : "Güvenlik doğrulaması başarısız oldu. Lütfen yeniden dene.",
      }, { status });
    }

    if (await findUserRowByEmail(email)) return noStoreJson({ error: "Bu e-posta zaten kayıtlı." }, { status: 409 });
    if (await findUserRowByUsername(username)) return noStoreJson({ error: "Bu kullanıcı adı alınmış." }, { status: 409 });

    if (supabaseProviderEnabled()) {
      try {
        const registration = await registerSupabaseAccount({
          email,
          password,
          username,
          displayName,
          birthDate,
          countryCode,
          cityId: canonicalCityId,
          country: location.country,
          city: location.city,
          color,
          legalConsent: { termsVersion: String(body.termsVersion), privacyVersion: String(body.privacyVersion) },
          emailRedirectTo: `${resolvePublicOrigin()}/auth/callback?flow=signup`,
        });
        return noStoreJson(registration, { status: 201 });
      } catch (error) {
        if (error instanceof UserIdentityConflictError) {
          return noStoreJson({ error: error.field === "email" ? "Bu e-posta zaten kayıtlı." : "Bu kullanıcı adı alınmış." }, { status: 409 });
        }
        if (error instanceof EmailDeliveryUnavailableError) {
          return noStoreJson({
            code: "EMAIL_DELIVERY_UNAVAILABLE",
            error: "Hesap doğrulama e-postası şu anda gönderilemiyor. E-posta hizmeti bağlantısı kontrol edildikten sonra yeniden dene.",
          }, { status: 503 });
        }
        throw error;
      }
    }

    const passwordResult = hashPassword(password);
    let user: Awaited<ReturnType<typeof createUser>>;
    try {
      user = await createUser({
        email, username, displayName, passwordHash: passwordResult.hash, passwordSalt: passwordResult.salt,
        color, birthDate, countryCode, cityId: canonicalCityId, country: location.country, city: location.city,
        legalConsent: { termsVersion: String(body.termsVersion), privacyVersion: String(body.privacyVersion) },
      });
    } catch (error) {
      if (error instanceof UserIdentityConflictError) {
        return noStoreJson({ error: error.field === "email" ? "Bu e-posta zaten kayıtlı." : "Bu kullanıcı adı alınmış." }, { status: 409 });
      }
      throw error;
    }
    await createSession(user.id, { persistent: true });
    return noStoreJson({ user }, { status: 201 });
  } catch (error) {
    const response = requestBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
