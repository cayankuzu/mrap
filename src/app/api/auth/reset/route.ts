import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after } from "next/server";
import { hashPassword } from "@/lib/auth";
import { CONTENT_LIMITS } from "@/lib/content-limits";
import { resolvePublicOrigin } from "@/lib/public-origin";
import { createPasswordResetToken, findUserRowByEmail, resetPasswordWithToken } from "@/lib/repository";
import { isValidEmail, normalizeEmail } from "@/lib/validation";
import { sendPasswordResetEmail, type PasswordResetEmailResult } from "@/server/email/password-reset-email";
import { API_BODY_BYTE_LIMITS, API_RATE_LIMITS, noStoreJson, requestBodyErrorResponse } from "@/server/http/api-security";
import { readLimitedJsonObject } from "@/server/http/limited-json";
import { checkRateLimit } from "@/server/http/rate-limit";
import { turnstileFailureStatus, verifyTurnstileMutation } from "@/features/security/turnstile/verify-turnstile";
import { completeSupabasePasswordReset, requestSupabasePasswordReset } from "@/lib/supabase/auth-operations";
import { supabaseProviderEnabled } from "@/lib/supabase/server-config";

const SUPABASE_RECOVERY_TOKEN = "supabase-session";

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function validPassword(password: string) {
  return password.length >= CONTENT_LIMITS.password.min && password.length <= CONTENT_LIMITS.password.max && /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(password) && /\d/.test(password);
}

function resetJson(value: unknown, correlationId: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("X-Correlation-Id", correlationId);
  return noStoreJson(value, { ...init, headers });
}

function reportDeliveryFailure(
  correlationId: string,
  result: Exclude<PasswordResetEmailResult, { ok: true }> | Readonly<{ reason: "pipeline_error" }>,
) {
  console.error(JSON.stringify({
    level: "error",
    event: "password_reset_email_delivery_failed",
    correlationId,
    reason: result.reason,
    ...("providerStatus" in result && result.providerStatus !== undefined
      ? { providerStatus: result.providerStatus }
      : {}),
  }));
}

export async function POST(request: Request) {
  const policy = API_RATE_LIMITS.authReset;
  const limited = await checkRateLimit(request, "auth-reset", policy.limit, policy.windowMs);
  if (limited) return limited;
  const correlationId = randomUUID();
  try {
    const body = await readLimitedJsonObject(request, API_BODY_BYTE_LIMITS.authReset);
    const token = String(body.token ?? "");

    if (token) {
      const newPassword = String(body.newPassword ?? "");
      if (!validPassword(newPassword)) return resetJson({ error: "Yeni şifre 8–128 karakter arasında, bir harf ve bir rakam içermeli." }, correlationId, { status: 400 });
      if (supabaseProviderEnabled()) {
        if (token !== SUPABASE_RECOVERY_TOKEN || !await completeSupabasePasswordReset(newPassword)) {
          return resetJson({ error: "Yenileme bağlantısı geçersiz veya süresi dolmuş." }, correlationId, { status: 400 });
        }
        return resetJson({ ok: true, completed: true }, correlationId);
      }
      if (token.length < 40 || token.length > 160) return resetJson({ error: "Yenileme bağlantısı geçersiz veya süresi dolmuş." }, correlationId, { status: 400 });
      const result = hashPassword(newPassword);
      if (!await resetPasswordWithToken(tokenHash(token), result.hash, result.salt)) return resetJson({ error: "Yenileme bağlantısı geçersiz veya süresi dolmuş." }, correlationId, { status: 400 });
      return resetJson({ ok: true, completed: true }, correlationId);
    }

    const email = normalizeEmail(String(body.email ?? ""));
    if (!isValidEmail(email)) return resetJson({ error: "Geçerli bir e-posta adresi yaz." }, correlationId, { status: 400 });
    const turnstile = await verifyTurnstileMutation({ token: body.turnstileToken, expectedAction: "password_reset" });
    if (!turnstile.ok) {
      const status = turnstileFailureStatus(turnstile);
      return resetJson({
        error: status === 503
          ? "Güvenlik doğrulaması şu anda kullanılamıyor. Lütfen yeniden dene."
          : "Güvenlik doğrulaması başarısız oldu. Lütfen yeniden dene.",
      }, correlationId, { status });
    }
    if (supabaseProviderEnabled()) {
      const callbackUrl = new URL("/auth/callback", resolvePublicOrigin());
      callbackUrl.searchParams.set("next", "/forgot-password?recovery=1");
      const delivery = await requestSupabasePasswordReset(email, callbackUrl.toString());
      if (!delivery.ok) reportDeliveryFailure(correlationId, { reason: "pipeline_error" });
      return resetJson({ ok: true, message: "Bu e-posta kayıtlıysa güvenli yenileme bağlantısı gönderildi." }, correlationId);
    }

    const user = await findUserRowByEmail(email);
    let developmentToken: string | undefined;
    if (process.env.NODE_ENV === "production") {
      // Run the same post-response path for existing and missing accounts so the
      // provider's network latency cannot become an account-enumeration signal.
      after(async () => {
        if (!user) return;
        try {
          const resetToken = randomBytes(32).toString("hex");
          await createPasswordResetToken(tokenHash(resetToken), user.id, new Date(Date.now() + 20 * 60 * 1000).toISOString());
          const resetUrl = `${resolvePublicOrigin()}/forgot-password?token=${encodeURIComponent(resetToken)}`;
          const delivery = await sendPasswordResetEmail({ email, resetUrl });
          if (!delivery.ok) reportDeliveryFailure(correlationId, delivery);
        } catch {
          reportDeliveryFailure(correlationId, { reason: "pipeline_error" });
        }
      });
    } else if (user) {
      const resetToken = randomBytes(32).toString("hex");
      await createPasswordResetToken(tokenHash(resetToken), user.id, new Date(Date.now() + 20 * 60 * 1000).toISOString());
      developmentToken = resetToken;
    }
    return resetJson({ ok: true, developmentToken, message: "Bu e-posta kayıtlıysa güvenli yenileme bağlantısı gönderildi." }, correlationId);
  } catch (error) {
    const response = requestBodyErrorResponse(error);
    if (response) {
      response.headers.set("X-Correlation-Id", correlationId);
      return response;
    }
    throw error;
  }
}
