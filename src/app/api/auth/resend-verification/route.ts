import { createHash, randomUUID } from "node:crypto";
import { EmailDeliveryUnavailableError, EmailVerificationRequestError, resendSupabaseVerification } from "@/lib/supabase/auth-operations";
import { supabaseProviderEnabled } from "@/lib/supabase/server-config";
import { resolvePublicOrigin } from "@/lib/public-origin";
import { isValidEmail, normalizeEmail } from "@/lib/validation";
import { API_BODY_BYTE_LIMITS, API_RATE_LIMITS, noStoreJson, requestBodyErrorResponse } from "@/server/http/api-security";
import { readLimitedJsonObject } from "@/server/http/limited-json";
import { checkRateLimit } from "@/server/http/rate-limit";
import { turnstileFailureStatus, verifyTurnstileMutation } from "@/features/security/turnstile/verify-turnstile";

export async function POST(request: Request) {
  try {
    const body = await readLimitedJsonObject(request, API_BODY_BYTE_LIMITS.authResendVerification);
    const email = normalizeEmail(String(body.email ?? ""));
    if (!isValidEmail(email)) return noStoreJson({ error: "Geçerli bir e-posta adresi yaz." }, { status: 400 });

    const emailScope = createHash("sha256").update(email).digest("hex").slice(0, 24);
    const policy = API_RATE_LIMITS.authResendVerification;
    const limited = await checkRateLimit(request, `auth-resend-verification:${emailScope}`, policy.limit, policy.windowMs);
    if (limited) return limited;

    const turnstile = await verifyTurnstileMutation({ token: body.turnstileToken, expectedAction: "resend_verification" });
    if (!turnstile.ok) {
      const status = turnstileFailureStatus(turnstile);
      return noStoreJson({ error: status === 503 ? "Güvenlik doğrulaması şu anda kullanılamıyor." : "Güvenlik doğrulaması başarısız oldu." }, { status });
    }
    if (!supabaseProviderEnabled()) {
      return noStoreJson({ error: "E-posta doğrulama hizmeti bu geliştirme ortamında bağlı değil." }, { status: 503 });
    }

    await resendSupabaseVerification(email, `${resolvePublicOrigin()}/auth/callback?flow=signup`);
    return noStoreJson({ accepted: true, requestId: randomUUID() }, { status: 202 });
  } catch (error) {
    const bodyResponse = requestBodyErrorResponse(error);
    if (bodyResponse) return bodyResponse;
    if (error instanceof EmailDeliveryUnavailableError) {
      return noStoreJson({ error: "Doğrulama e-postası şu anda teslim edilemiyor. E-posta sağlayıcısı bağlantısı kontrol edildikten sonra yeniden dene." }, { status: 503 });
    }
    if (error instanceof EmailVerificationRequestError) {
      return noStoreJson({ error: "Doğrulama e-postası şu anda istenemiyor. Lütfen daha sonra yeniden dene." }, { status: 503 });
    }
    throw error;
  }
}
