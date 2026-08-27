import { describe, expect, it, vi } from "vitest";
import { postComposerDraftKey, readPostComposerDraft, removePostComposerDraft, writePostComposerDraft } from "@/lib/post-composer-draft";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe("gönderi taslağı", () => {
  it("yalnız sınırlı metin ve alan kimliğini saklar; medya, kadraj ve konum içermez", () => {
    const storage = memoryStorage();
    const key = postComposerDraftKey("user-1");
    writePostComposerDraft(storage, key, { title: "Başlık", body: "Açıklama", territoryId: "territory-1" });

    expect(readPostComposerDraft(storage, key)).toEqual({ title: "Başlık", body: "Açıklama", territoryId: "territory-1" });
    const serialized = storage.data.get(key) ?? "";
    expect(serialized).not.toMatch(/image|snapshot|mapView|coordinate|latitude|longitude/i);
    expect(serialized.length).toBeLessThan(700);
  });

  it("fazla alan, bozuk JSON ve sınır dışı içeriği güvenli biçimde yok sayar", () => {
    const storage = memoryStorage();
    storage.data.set("draft", "{bozuk");
    expect(readPostComposerDraft(storage, "draft")).toBeNull();
    storage.data.set("draft", JSON.stringify({ v: 1, title: "x".repeat(81), body: "", territoryId: "", images: [] }));
    expect(readPostComposerDraft(storage, "draft")).toBeNull();
  });

  it("storage hatalarının composerı kırmasına izin vermez ve başarıda taslağı temizler", () => {
    const failing = { getItem: vi.fn(() => { throw new Error("blocked"); }), setItem: vi.fn(() => { throw new Error("blocked"); }), removeItem: vi.fn(() => { throw new Error("blocked"); }) };
    expect(() => writePostComposerDraft(failing, "draft", { title: "A", body: "", territoryId: "" })).not.toThrow();
    expect(readPostComposerDraft(failing, "draft")).toBeNull();
    expect(() => removePostComposerDraft(failing, "draft")).not.toThrow();

    const storage = memoryStorage();
    writePostComposerDraft(storage, "draft", { title: "A", body: "", territoryId: "" });
    removePostComposerDraft(storage, "draft");
    expect(storage.data.has("draft")).toBe(false);
  });
});
