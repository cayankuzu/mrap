import type { AppUser } from "@/lib/models";

export class UserIdentityConflictError extends Error {
  constructor(public readonly field: "email" | "username") {
    super(field === "email" ? "E-posta zaten kayıtlı." : "Kullanıcı adı zaten alınmış.");
    this.name = "UserIdentityConflictError";
  }
}

export type UserRow = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  color: string;
  pattern: number;
  country_code: string;
  city_id: string;
  country: string;
  city: string;
  bio: string;
  birth_date: string;
  account_visibility: AppUser["accountVisibility"];
  location_visibility: AppUser["locationVisibility"];
  /** Raw media is only present on narrow media reads. */
  avatar_data?: string | null;
  cover_data?: string | null;
  user_has_avatar?: number;
  user_has_cover?: number;
  avatar_object_key?: string | null;
  cover_object_key?: string | null;
  created_at: string;
};
