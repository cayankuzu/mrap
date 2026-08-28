"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { AppShell } from "@/components/AppShell";
import type { ProfileSaveInput, ProfileSaveResult } from "@/components/SettingsClient";
import { normalizeRouteColor, resolveLocation } from "@/lib/app-config";
import { DEFAULT_DEMO_USER, DEMO_PLAYERS, DEMO_PROFILE_STORAGE_KEY } from "@/lib/demo-profile";
import { clearDemoSocialState, DEMO_SOCIAL_STORAGE_KEY, EMPTY_DEMO_SOCIAL_STATE, readDemoSocialState, toggleDemoFollowRelation, writeDemoSocialState, type DemoFollowRelation, type DemoSocialState, type DemoStoredComment } from "@/lib/demo-social-state";
import type { AppUser } from "@/lib/models";
import { isValidUsername, normalizeUsername } from "@/lib/validation";

type DemoProfileContextValue = {
  user: AppUser;
  hydrated: boolean;
  saveProfile: (input: ProfileSaveInput) => Promise<ProfileSaveResult>;
  resetProfile: () => AppUser;
  social: DemoSocialState;
  togglePostLike: (postId: string) => void;
  togglePostSave: (postId: string) => void;
  toggleFollow: (username: string, accountVisibility?: "public" | "private", initialRelation?: DemoFollowRelation) => void;
  markPostShared: (postId: string) => void;
  addPostComment: (postId: string, body: string) => DemoStoredComment;
};

const DemoProfileContext = createContext<DemoProfileContextValue | null>(null);
const DEMO_PROFILE_EVENT = "mrap:demo-profile-change";
const DEMO_SOCIAL_EVENT = "mrap:demo-social-change";

function initialsFor(displayName: string) {
  return displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("tr-TR");
}

function worldLocationFromInput(value: {
  countryCode?: unknown;
  cityId?: unknown;
  country?: unknown;
  city?: unknown;
}) {
  if (typeof value.countryCode !== "string" || !/^[A-Z]{2}$/.test(value.countryCode)) return null;
  if (typeof value.cityId !== "string" || !/^csc:[A-Z]{2}:[^:]+:\d+$/.test(value.cityId)) return null;
  if (!value.cityId.startsWith(`csc:${value.countryCode}:`)) return null;
  if (typeof value.country !== "string" || value.country.trim().length < 2 || value.country.length > 80) return null;
  if (typeof value.city !== "string" || value.city.trim().length < 1 || value.city.length > 120) return null;
  return { country: value.country.trim(), city: value.city.trim() };
}

function safeStoredUser(value: unknown): AppUser {
  if (!value || typeof value !== "object") return DEFAULT_DEMO_USER;
  const stored = value as Partial<AppUser>;
  const location = typeof stored.countryCode === "string" && typeof stored.cityId === "string"
    ? resolveLocation(stored.countryCode, stored.cityId) ?? worldLocationFromInput(stored)
    : null;
  const displayName = typeof stored.displayName === "string" && stored.displayName.trim().length >= 2 ? stored.displayName.trim().slice(0, 60) : DEFAULT_DEMO_USER.displayName;
  const username = typeof stored.username === "string" && isValidUsername(stored.username) ? normalizeUsername(stored.username) : DEFAULT_DEMO_USER.username;
  const color = normalizeRouteColor(stored.color) ?? DEFAULT_DEMO_USER.color;
  const image = (candidate: unknown) => candidate === null || typeof candidate === "string" && /^data:image\/jpeg;base64,/i.test(candidate) ? candidate as string | null : null;
  return {
    ...DEFAULT_DEMO_USER,
    username,
    displayName,
    initials: initialsFor(displayName),
    color,
    bio: typeof stored.bio === "string" ? stored.bio.slice(0, 180) : DEFAULT_DEMO_USER.bio,
    countryCode: location ? stored.countryCode! : DEFAULT_DEMO_USER.countryCode,
    cityId: location ? stored.cityId! : DEFAULT_DEMO_USER.cityId,
    country: location?.country ?? DEFAULT_DEMO_USER.country,
    city: location?.city ?? DEFAULT_DEMO_USER.city,
    birthDate: typeof stored.birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stored.birthDate) ? stored.birthDate : DEFAULT_DEMO_USER.birthDate,
    accountVisibility: stored.accountVisibility === "private" ? "private" : "public",
    locationVisibility: "private",
    avatarData: image(stored.avatarData),
    coverData: image(stored.coverData),
  };
}

function validateProfile(input: ProfileSaveInput) {
  const displayName = input.displayName.trim();
  const username = normalizeUsername(input.username);
  const bio = input.bio.trim();
  const location = resolveLocation(input.countryCode, input.cityId) ?? worldLocationFromInput(input);
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) ? new Date(`${input.birthDate}T00:00:00Z`) : null;
  const today = new Date();
  let age = birth && !Number.isNaN(birth.getTime()) ? today.getUTCFullYear() - birth.getUTCFullYear() : -1;
  if (birth && (today.getUTCMonth() < birth.getUTCMonth() || today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())) age -= 1;
  if (displayName.length < 2 || displayName.length > 60) return { error: "Ad soyad 2–60 karakter olmalı." } as const;
  if (!isValidUsername(username)) return { error: "Kullanıcı adı 3–20 karakter ve yalnızca harf (Türkçe karakterler dahil), rakam veya _ içermeli." } as const;
  if (DEMO_PLAYERS.some((player) => player.username === username)) return { error: "Bu kullanıcı adı alınmış." } as const;
  if (!location) return { error: "Geçerli bir ülke ve şehir seç." } as const;
  if (bio.length > 180) return { error: "Biyografi 180 karakteri geçemez." } as const;
  if (!birth || age < 13 || age > 100) return { error: "Geçerli bir doğum tarihi ve en az 13 yaş gerekli." } as const;
  if (!normalizeRouteColor(input.color)) return { error: "Geçersiz renk." } as const;
  if ([input.avatarData, input.coverData].some((image) => image && (!/^data:image\/jpeg;base64,/i.test(image) || image.length > 650_000))) return { error: "Profil görselleri güvenli yükleme sınırını aşıyor." } as const;
  return { displayName, username, bio, location } as const;
}

let cachedStoredValue: string | null | undefined;
let cachedStoredUser = DEFAULT_DEMO_USER;

function readDemoProfile() {
  try {
    const stored = window.localStorage.getItem(DEMO_PROFILE_STORAGE_KEY);
    if (stored === cachedStoredValue) return cachedStoredUser;
    cachedStoredValue = stored;
    cachedStoredUser = stored ? safeStoredUser(JSON.parse(stored)) : DEFAULT_DEMO_USER;
    return cachedStoredUser;
  } catch {
    try { window.localStorage.removeItem(DEMO_PROFILE_STORAGE_KEY); } catch { /* Depolama kapalıysa varsayılan profil kullanılır. */ }
    cachedStoredValue = null;
    cachedStoredUser = DEFAULT_DEMO_USER;
    return cachedStoredUser;
  }
}

function subscribeToDemoProfile(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === DEMO_PROFILE_STORAGE_KEY) onStoreChange(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(DEMO_PROFILE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DEMO_PROFILE_EVENT, onStoreChange);
  };
}

function subscribeToHydration() {
  return () => undefined;
}

function subscribeToDemoSocial(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === DEMO_SOCIAL_STORAGE_KEY) onStoreChange(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(DEMO_SOCIAL_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DEMO_SOCIAL_EVENT, onStoreChange);
  };
}

function toggleInList(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function DemoProfileProvider({ children }: { children: React.ReactNode }) {
  const user = useSyncExternalStore(subscribeToDemoProfile, readDemoProfile, () => DEFAULT_DEMO_USER);
  const social = useSyncExternalStore(subscribeToDemoSocial, () => readDemoSocialState(window.localStorage), () => EMPTY_DEMO_SOCIAL_STATE);
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);

  const updateSocial = useCallback((update: (current: DemoSocialState) => DemoSocialState) => {
    const next = writeDemoSocialState(window.localStorage, update(readDemoSocialState(window.localStorage)));
    window.dispatchEvent(new Event(DEMO_SOCIAL_EVENT));
    return next;
  }, []);

  const togglePostLike = useCallback((postId: string) => {
    updateSocial((current) => ({ ...current, likedPostIds: toggleInList(current.likedPostIds, postId) }));
  }, [updateSocial]);

  const togglePostSave = useCallback((postId: string) => {
    updateSocial((current) => ({ ...current, savedPostIds: toggleInList(current.savedPostIds, postId) }));
  }, [updateSocial]);

  const toggleFollow = useCallback((username: string, accountVisibility: "public" | "private" = "public", initialRelation: DemoFollowRelation = "none") => {
    updateSocial((current) => toggleDemoFollowRelation(current, { username, accountVisibility, initialRelation }));
  }, [updateSocial]);

  const markPostShared = useCallback((postId: string) => {
    updateSocial((current) => current.sharedPostIds.includes(postId) ? current : { ...current, sharedPostIds: [...current.sharedPostIds, postId] });
  }, [updateSocial]);

  const addPostComment = useCallback((postId: string, body: string) => {
    const comment: DemoStoredComment = {
      id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `comment-${Date.now()}`,
      body: body.trim(),
      createdAt: new Date().toISOString(),
    };
    updateSocial((current) => ({
      ...current,
      commentsByPost: { ...current.commentsByPost, [postId]: [comment, ...(current.commentsByPost[postId] ?? [])].slice(0, 50) },
    }));
    return comment;
  }, [updateSocial]);

  const saveProfile = useCallback(async (input: ProfileSaveInput): Promise<ProfileSaveResult> => {
    const validation = validateProfile(input);
    if ("error" in validation) return validation;
    const nextUser: AppUser = {
      ...user,
      username: validation.username,
      displayName: validation.displayName,
      initials: initialsFor(validation.displayName),
      bio: validation.bio,
      countryCode: input.countryCode,
      cityId: input.cityId,
      country: validation.location.country,
      city: validation.location.city,
      birthDate: input.birthDate,
      color: input.color,
      accountVisibility: input.accountVisibility,
      locationVisibility: "private",
      avatarData: input.avatarData,
      coverData: input.coverData,
    };
    try {
      const serialized = JSON.stringify(nextUser);
      window.localStorage.setItem(DEMO_PROFILE_STORAGE_KEY, serialized);
      cachedStoredValue = serialized;
      cachedStoredUser = nextUser;
      window.dispatchEvent(new Event(DEMO_PROFILE_EVENT));
      return { user: nextUser };
    } catch {
      return { error: "Demo profili bu tarayıcıda saklanamadı." };
    }
  }, [user]);

  const resetProfile = useCallback(() => {
    try {
      window.localStorage.removeItem(DEMO_PROFILE_STORAGE_KEY);
      window.localStorage.removeItem(`mrap:route-color:${DEFAULT_DEMO_USER.id}`);
      clearDemoSocialState(window.localStorage);
    } catch { /* Depolama kapalıysa bellek içi profil yine sıfırlanır. */ }
    cachedStoredValue = null;
    cachedStoredUser = DEFAULT_DEMO_USER;
    window.dispatchEvent(new Event(DEMO_PROFILE_EVENT));
    window.dispatchEvent(new Event(DEMO_SOCIAL_EVENT));
    return DEFAULT_DEMO_USER;
  }, []);

  return <DemoProfileContext.Provider value={{ user, hydrated, saveProfile, resetProfile, social, togglePostLike, togglePostSave, toggleFollow, markPostShared, addPostComment }}>{children}</DemoProfileContext.Provider>;
}

export function useDemoProfile() {
  const context = useContext(DemoProfileContext);
  if (!context) throw new Error("useDemoProfile, DemoProfileProvider içinde kullanılmalı.");
  return context;
}

function DemoShellContent({ children }: { children: React.ReactNode }) {
  const { user } = useDemoProfile();
  return <AppShell user={user} demo>{children}</AppShell>;
}

export function DemoShell({ children }: { children: React.ReactNode }) {
  return <DemoProfileProvider><DemoShellContent>{children}</DemoShellContent></DemoProfileProvider>;
}
