import "server-only";

import { createMrapSupabaseAdminClient } from "@/lib/supabase/admin-client";
import { ensureSupabaseLocationCatalog } from "@/lib/supabase/location-catalog";
import { createMrapSupabaseServerClient } from "@/lib/supabase/server-client";
import { findUserRowById, findUserRowByUsername, toPublicUser, UserIdentityConflictError } from "@/lib/repository";

export class EmailDeliveryUnavailableError extends Error {
  constructor() {
    super("E-posta doğrulama hizmeti şu anda kullanılamıyor.");
    this.name = "EmailDeliveryUnavailableError";
  }
}

export class EmailVerificationRequestError extends Error {
  constructor() {
    super("Doğrulama e-postası isteği tamamlanamadı.");
    this.name = "EmailVerificationRequestError";
  }
}

function emailDeliveryUnavailable(error: { message?: string; status?: number; code?: string } | null) {
  if (!error) return false;
  const message = error.message?.toLocaleLowerCase("en-US") ?? "";
  return message.includes("smtp")
    || message.includes("error sending confirmation email")
    || message.includes("email provider")
    || message.includes("email") && (message.includes("send") || message.includes("deliver"));
}

export async function registerSupabaseAccount(input: {
  email: string;
  password: string;
  username: string;
  displayName: string;
  birthDate: string;
  countryCode: string;
  cityId: string;
  country: string;
  city: string;
  color: string;
  legalConsent: { termsVersion: string; privacyVersion: string };
  emailRedirectTo: string;
}) {
  if (await findUserRowByUsername(input.username)) throw new UserIdentityConflictError("username");
  await ensureSupabaseLocationCatalog({
    countryCode: input.countryCode,
    country: input.country,
    cityId: input.cityId,
    city: input.city,
  });
  const admin = createMrapSupabaseAdminClient();
  const client = await createMrapSupabaseServerClient();
  const created = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: input.emailRedirectTo,
      data: {
        username: input.username,
        display_name: input.displayName,
        birth_date: input.birthDate,
        country_code: input.countryCode,
        city_id: input.cityId,
        color: input.color,
      },
    },
  });
  if (created.error || !created.data.user || created.data.user.identities?.length === 0) {
    const message = created.error?.message.toLocaleLowerCase("en-US") ?? "";
    if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
      throw new UserIdentityConflictError("email");
    }
    if (created.data.user?.identities?.length === 0) throw new UserIdentityConflictError("email");
    if (emailDeliveryUnavailable(created.error)) {
      if (created.data.user) await admin.auth.admin.deleteUser(created.data.user.id, false);
      throw new EmailDeliveryUnavailableError();
    }
    throw new Error("Supabase hesabı oluşturulamadı.");
  }
  const userId = created.data.user.id;
  try {
    const consent = await admin.from("legal_consents").insert({
      user_id: userId,
      terms_version: input.legalConsent.termsVersion,
      privacy_version: input.legalConsent.privacyVersion,
    });
    if (consent.error) throw new Error("Yasal onay kaydı oluşturulamadı.");
    const row = await findUserRowById(userId);
    if (!row) throw new Error("Oluşturulan profil okunamadı.");
    return {
      user: { ...await toPublicUser(row), email: created.data.user.email ?? input.email },
      requiresEmailVerification: !created.data.user.email_confirmed_at,
    };
  } catch (error) {
    await admin.auth.admin.deleteUser(userId, false);
    throw error;
  }
}

export async function signInSupabaseAccount(email: string, password: string) {
  const client = await createMrapSupabaseServerClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  const errorCode = error?.code ?? "";
  const errorMessage = error?.message.toLocaleLowerCase("en-US") ?? "";
  if (errorCode === "email_not_confirmed" || errorMessage.includes("email not confirmed")) {
    return { status: "email_unverified" as const };
  }
  if (error || !data.user) return { status: "invalid_credentials" as const };
  if (!data.user.email_confirmed_at) {
    await client.auth.signOut();
    return { status: "email_unverified" as const };
  }
  const row = await findUserRowById(data.user.id);
  if (!row) {
    await client.auth.signOut();
    return { status: "invalid_credentials" as const };
  }
  return { status: "authenticated" as const, user: { ...await toPublicUser(row), email: data.user.email ?? email } };
}

export async function resendSupabaseVerification(email: string, emailRedirectTo: string) {
  const client = await createMrapSupabaseServerClient();
  const { error } = await client.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo },
  });
  if (emailDeliveryUnavailable(error)) throw new EmailDeliveryUnavailableError();
  if (error) throw new EmailVerificationRequestError();
  // Deliberately return the same result for unknown and existing accounts.
  return { accepted: true as const };
}

export async function requestSupabasePasswordReset(email: string, redirectTo: string) {
  const client = await createMrapSupabaseServerClient();
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  return error ? { ok: false as const } : { ok: true as const };
}

export async function completeSupabasePasswordReset(password: string) {
  const client = await createMrapSupabaseServerClient();
  const current = await client.auth.getUser();
  if (current.error || !current.data.user) return false;
  const updated = await client.auth.updateUser({ password });
  return !updated.error && Boolean(updated.data.user);
}
