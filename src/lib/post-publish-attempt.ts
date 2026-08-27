const ATTEMPT_VERSION = 1;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{16}$/;

export type PostPublishAttemptIdentity = {
  fingerprint: string;
  key: string;
};

export type PostPublishAttemptStore = {
  read: () => PostPublishAttemptIdentity | null;
  write: (identity: PostPublishAttemptIdentity) => void;
  remove: () => void;
};

type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function postPublishAttemptKey(userId: string) {
  return `mrap:post-attempt:${encodeURIComponent(userId)}`;
}

export function fingerprintPostPublishPayload(serializedPayload: string) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < serializedPayload.length; index += 1) {
    const value = serializedPayload.charCodeAt(index);
    left = Math.imul(left ^ value, 0x01000193) >>> 0;
    right = Math.imul(right ^ (value + index), 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

export function createPostPublishAttemptStore(storage: AttemptStorage, storageKey: string): PostPublishAttemptStore {
  return {
    read() {
      try {
        const raw = storage.getItem(storageKey);
        if (!raw || raw.length > 256) return null;
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        if (Object.keys(parsed).some((field) => !["v", "fingerprint", "key"].includes(field))) return null;
        const value = parsed as { v?: unknown; fingerprint?: unknown; key?: unknown };
        if (value.v !== ATTEMPT_VERSION || typeof value.fingerprint !== "string" || typeof value.key !== "string") return null;
        return FINGERPRINT_PATTERN.test(value.fingerprint) && IDEMPOTENCY_KEY_PATTERN.test(value.key)
          ? { fingerprint: value.fingerprint, key: value.key }
          : null;
      } catch {
        return null;
      }
    },
    write(identity) {
      try {
        if (!FINGERPRINT_PATTERN.test(identity.fingerprint) || !IDEMPOTENCY_KEY_PATTERN.test(identity.key)) return;
        storage.setItem(storageKey, JSON.stringify({ v: ATTEMPT_VERSION, fingerprint: identity.fingerprint, key: identity.key }));
      } catch {
        // Session storage can be unavailable; in-memory retry safety remains active.
      }
    },
    remove() {
      try { storage.removeItem(storageKey); }
      catch { /* Best effort in strict privacy modes. */ }
    },
  };
}
