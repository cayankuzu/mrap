import "server-only";

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSessionRecord, deleteSessionRecord, findUserBySession, findUserRowById, toPublicUser } from "@/lib/repository";
import { SESSION_COOKIE } from "@/lib/auth-config";
import { normalizeProtectedReturnPath } from "@/lib/safe-navigation";
import { createMrapSupabaseServerClient } from "@/lib/supabase/server-client";
import { resolveSupabaseServerConfig, supabaseProviderEnabled } from "@/lib/supabase/server-config";

export { SESSION_COOKIE } from "@/lib/auth-config";
const PERSISTENT_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30;
const TRANSIENT_SESSION_DURATION_MS = 1000 * 60 * 60 * 12;

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

export function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function verifyCurrentUserPassword(userId: string, password: string) {
  if (supabaseProviderEnabled()) {
    const user = await getCurrentUser();
    if (!user || user.id !== userId || !user.email) return false;
    const config = resolveSupabaseServerConfig();
    if (!config.enabled) return false;
    const verifier = createClient(config.url, config.publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const { data, error } = await verifier.auth.signInWithPassword({ email: user.email, password });
    return !error && data.user?.id === userId;
  }
  const user = await findUserRowById(userId);
  return Boolean(user && verifyPassword(password, user.password_salt, user.password_hash));
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, options: { persistent: boolean }) {
  if (supabaseProviderEnabled()) {
    throw new Error("Supabase oturumu signInWithPassword kayıt sınırında oluşturulmalı.");
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + (options.persistent ? PERSISTENT_SESSION_DURATION_MS : TRANSIENT_SESSION_DURATION_MS));
  await createSessionRecord(hashToken(token), userId, expiresAt.toISOString());
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(options.persistent ? { expires: expiresAt } : {}),
    priority: "high",
  });
}

export async function destroySession() {
  if (supabaseProviderEnabled()) {
    const client = await createMrapSupabaseServerClient();
    await client.auth.signOut();
    return;
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await deleteSessionRecord(hashToken(token));
  cookieStore.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async function getCurrentUser() {
  if (supabaseProviderEnabled()) {
    const client = await createMrapSupabaseServerClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    if (!data.user.email_confirmed_at) {
      await client.auth.signOut();
      return null;
    }
    const row = await findUserRowById(data.user.id);
    const user = row ? await toPublicUser(row) : null;
    return user ? { ...user, email: data.user.email ?? row?.email ?? "" } : null;
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? await findUserBySession(hashToken(token)) : null;
});

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    const returnTo = normalizeProtectedReturnPath((await headers()).get("x-mrap-return-to"));
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }
  return user;
}
