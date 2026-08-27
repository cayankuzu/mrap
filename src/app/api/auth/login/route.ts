import { createSession, hashPassword, verifyPassword } from "@/lib/auth";
import { CONTENT_LIMITS } from "@/lib/content-limits";
import { findUserRowByEmail, toPublicUser } from "@/lib/repository";
import { signInSupabaseAccount } from "@/lib/supabase/auth-operations";
import { supabaseProviderEnabled } from "@/lib/supabase/server-config";
import { normalizeEmail } from "@/lib/validation";
import { API_BODY_BYTE_LIMITS, API_RATE_LIMITS, noStoreJson, requestBodyErrorResponse } from "@/server/http/api-security";
import { readLimitedJsonObject } from "@/server/http/limited-json";
import { checkRateLimit } from "@/server/http/rate-limit";

const dummyPassword = hashPassword("mrap-dummy-password-9371", "0123456789abcdef0123456789abcdef");

export async function POST(request: Request) {
  const policy = API_RATE_LIMITS.authLogin;
  const limited = await checkRateLimit(request, "auth-login", policy.limit, policy.windowMs);
  if (limited) return limited;
  try {
    const body = await readLimitedJsonObject(request, API_BODY_BYTE_LIMITS.authLogin);
    const email = normalizeEmail(String(body.email ?? ""));
    const password = String(body.password ?? "");
    if (body.remember !== undefined && typeof body.remember !== "boolean") return noStoreJson({ error: "Oturum tercihi geçersiz." }, { status: 400 });
    if (email.length > CONTENT_LIMITS.email.max || password.length > CONTENT_LIMITS.password.max) return noStoreJson({ error: "E-posta veya şifre hatalı." }, { status: 401 });
    if (supabaseProviderEnabled()) {
      const user = await signInSupabaseAccount(email, password);
      if (!user) return noStoreJson({ error: "E-posta veya şifre hatalı." }, { status: 401 });
      return noStoreJson({ user });
    }

    const userRow = await findUserRowByEmail(email);

    const passwordValid = userRow
      ? verifyPassword(password, userRow.password_salt, userRow.password_hash)
      : verifyPassword(password, dummyPassword.salt, dummyPassword.hash);
    if (!userRow || !passwordValid) {
      return noStoreJson({ error: "E-posta veya şifre hatalı." }, { status: 401 });
    }

    await createSession(userRow.id, { persistent: body.remember === true });
    return noStoreJson({ user: await toPublicUser(userRow) });
  } catch (error) {
    const response = requestBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
