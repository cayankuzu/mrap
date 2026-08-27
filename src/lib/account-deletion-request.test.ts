import { describe, expect, it } from "vitest";
import { isAccountDeletionConfirmed, readAccountDeletionBody } from "@/lib/account-deletion-request";

function jsonRequest(body: string, headers?: HeadersInit) {
  return new Request("http://localhost/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

describe("hesap silme isteği doğrulaması", () => {
  it("yalnızca tam kullanıcı adı ve açık kalıcı silme onayını kabul eder", () => {
    expect(isAccountDeletionConfirmed({ confirmation: "oyuncu_1", acknowledged: true, password: "gecerli-sifre" }, "oyuncu_1")).toBe(true);
    expect(isAccountDeletionConfirmed({ confirmation: "@oyuncu_1", acknowledged: true, password: "gecerli-sifre" }, "oyuncu_1")).toBe(false);
    expect(isAccountDeletionConfirmed({ confirmation: " OYUNCU_1 ", acknowledged: true, password: "gecerli-sifre" }, "oyuncu_1")).toBe(false);
    expect(isAccountDeletionConfirmed({ confirmation: "oyuncu_1", acknowledged: false, password: "gecerli-sifre" }, "oyuncu_1")).toBe(false);
    expect(isAccountDeletionConfirmed({ confirmation: "oyuncu_1", acknowledged: true, password: "" }, "oyuncu_1")).toBe(false);
  });

  it("doğru ve küçük JSON gövdesini okur", async () => {
    await expect(readAccountDeletionBody(jsonRequest(JSON.stringify({ confirmation: "oyuncu_1", acknowledged: true, password: "gecerli-sifre" }))))
      .resolves.toEqual({ ok: true, payload: { confirmation: "oyuncu_1", acknowledged: true, password: "gecerli-sifre" } });
  });

  it("eksik, fazla veya yanlış tipli alanları reddeder", async () => {
    await expect(readAccountDeletionBody(jsonRequest(JSON.stringify({ confirmation: "oyuncu_1", acknowledged: true }))))
      .resolves.toEqual({ ok: false, reason: "invalid_json" });
    await expect(readAccountDeletionBody(jsonRequest(JSON.stringify({ confirmation: "oyuncu_1", acknowledged: true, password: "gecerli-sifre", role: "admin" }))))
      .resolves.toEqual({ ok: false, reason: "invalid_json" });
    await expect(readAccountDeletionBody(jsonRequest(JSON.stringify({ confirmation: "oyuncu_1", acknowledged: "true", password: "gecerli-sifre" }))))
      .resolves.toEqual({ ok: false, reason: "invalid_json" });
    await expect(readAccountDeletionBody(jsonRequest(JSON.stringify({ confirmation: "oyuncu_1", acknowledged: true, password: "" }))))
      .resolves.toEqual({ ok: false, reason: "invalid_json" });
  });

  it("yanlış içerik türünü ve bozuk JSON'u reddeder", async () => {
    const wrongType = new Request("http://localhost/api/account", { method: "DELETE", body: "{}" });
    await expect(readAccountDeletionBody(wrongType)).resolves.toEqual({ ok: false, reason: "unsupported_media_type" });
    await expect(readAccountDeletionBody(jsonRequest("{"))).resolves.toEqual({ ok: false, reason: "invalid_json" });
  });

  it("bildirilen veya stream üzerinden gelen büyük gövdeyi reddeder", async () => {
    await expect(readAccountDeletionBody(jsonRequest("{}", { "Content-Length": "4097" })))
      .resolves.toEqual({ ok: false, reason: "too_large" });
    await expect(readAccountDeletionBody(jsonRequest(JSON.stringify({ confirmation: "x".repeat(700), acknowledged: true, password: "gecerli-sifre" }))))
      .resolves.toEqual({ ok: false, reason: "too_large" });
  });
});
