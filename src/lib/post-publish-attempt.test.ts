import { describe, expect, it } from "vitest";
import { createPostPublishAttemptStore, fingerprintPostPublishPayload, postPublishAttemptKey } from "@/lib/post-publish-attempt";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe("gönderi deneme kimliği", () => {
  it("payload içeriğini saklamadan sabit bir fingerprint ve güvenli anahtar saklar", () => {
    const storage = memoryStorage();
    const key = postPublishAttemptKey("user-1");
    const store = createPostPublishAttemptStore(storage, key);
    const fingerprint = fingerprintPostPublishPayload(JSON.stringify({ title: "Gizli taslak", image: "base64-secret" }));

    store.write({ fingerprint, key: "11111111-2222-4333-8444-555555555555" });

    expect(store.read()).toEqual({ fingerprint, key: "11111111-2222-4333-8444-555555555555" });
    expect(storage.data.get(key)).not.toMatch(/Gizli taslak|base64-secret/);
  });

  it("bozuk veya beklenmeyen alan içeren storage kaydını kullanmaz", () => {
    const storage = memoryStorage();
    const store = createPostPublishAttemptStore(storage, "attempt");
    storage.data.set("attempt", JSON.stringify({ v: 1, fingerprint: "0".repeat(16), key: "short", payload: "secret" }));

    expect(store.read()).toBeNull();
    expect(() => store.remove()).not.toThrow();
    expect(storage.data.has("attempt")).toBe(false);
  });

  it("aynı payload için aynı, değişen payload için farklı fingerprint üretir", () => {
    expect(fingerprintPostPublishPayload("same")).toBe(fingerprintPostPublishPayload("same"));
    expect(fingerprintPostPublishPayload("same")).not.toBe(fingerprintPostPublishPayload("changed"));
  });
});
