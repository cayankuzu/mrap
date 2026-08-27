import { describe, expect, it } from "vitest";
import { clearPrivateClientState } from "@/lib/private-client-state";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("özel istemci verisi temizliği", () => {
  it("yalnızca çıkan gerçek kullanıcıya ait rota, taslak ve renk anahtarlarını siler", () => {
    const sessionStorage = new MemoryStorage();
    const localStorage = new MemoryStorage();
    sessionStorage.setItem("mrap:active-route:user-1", "nonce");
    sessionStorage.setItem("mrap:route-point-queue:user-1", "raw-gps");
    sessionStorage.setItem("mrap:offline-route-draft:user-1", "raw-gps-draft");
    sessionStorage.setItem("mrap:post-draft:user-1", "draft");
    sessionStorage.setItem("mrap:post-draft:user-2", "keep");
    localStorage.setItem("mrap:route-color:user-1", "#fff");
    localStorage.setItem("mrap:demo-profile:v1", "keep-demo");

    clearPrivateClientState({ sessionStorage, localStorage }, "user-1");

    expect(sessionStorage.getItem("mrap:active-route:user-1")).toBeNull();
    expect(sessionStorage.getItem("mrap:route-point-queue:user-1")).toBeNull();
    expect(sessionStorage.getItem("mrap:offline-route-draft:user-1")).toBeNull();
    expect(sessionStorage.getItem("mrap:post-draft:user-1")).toBeNull();
    expect(localStorage.getItem("mrap:route-color:user-1")).toBeNull();
    expect(sessionStorage.getItem("mrap:post-draft:user-2")).toBe("keep");
    expect(localStorage.getItem("mrap:demo-profile:v1")).toBe("keep-demo");
  });
});
