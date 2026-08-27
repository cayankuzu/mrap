export type UserMediaKind = "avatar" | "cover";

/** Returns an authenticated media endpoint without exposing persisted base64 in RSC/API payloads. */
export function userMediaReference(userId: string, kind: UserMediaKind, present: boolean) {
  return present ? `/api/users/${encodeURIComponent(userId)}/${kind}` : null;
}
