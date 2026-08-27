import "server-only";

import { createMrapSupabaseAdminClient } from "@/lib/supabase/admin-client";
import { createMrapSupabaseServerClient } from "@/lib/supabase/server-client";
import { findUserRowById, findUserRowByUsername, toPublicUser, UserIdentityConflictError } from "@/lib/repository";

export async function registerSupabaseAccount(input: {
  email: string;
  password: string;
  username: string;
  displayName: string;
  birthDate: string;
  countryCode: string;
  cityId: string;
  color: string;
  legalConsent: { termsVersion: string; privacyVersion: string };
  emailRedirectTo: string;
}) {
  if (await findUserRowByUsername(input.username)) throw new UserIdentityConflictError("username");
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
      requiresEmailVerification: !created.data.session,
    };
  } catch (error) {
    await admin.auth.admin.deleteUser(userId, false);
    throw error;
  }
}

export async function signInSupabaseAccount(email: string, password: string) {
  const client = await createMrapSupabaseServerClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;
  const row = await findUserRowById(data.user.id);
  if (!row) {
    await client.auth.signOut();
    return null;
  }
  return { ...await toPublicUser(row), email: data.user.email ?? email };
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
