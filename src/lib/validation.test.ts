import { describe, expect, it } from "vitest";
import { isValidEmail, isValidUsername, normalizeEmail, normalizeUsername, parseIsoCalendarDate, resolvePostTitle } from "@/lib/validation";

describe("takvim doğrulaması", () => {
  it("yalnızca gerçek ISO takvim tarihlerini kabul eder", () => {
    expect(parseIsoCalendarDate("2000-02-29")?.toISOString()).toBe("2000-02-29T00:00:00.000Z");
    expect(parseIsoCalendarDate("1990-02-31")).toBeNull();
    expect(parseIsoCalendarDate("2025-02-29")).toBeNull();
    expect(parseIsoCalendarDate("2024-13-01")).toBeNull();
    expect(parseIsoCalendarDate("01.01.2000")).toBeNull();
  });
});

describe("hesap alanı doğrulaması", () => {
  it("e-posta ve kullanıcı adını tutarlı biçimde normalize eder", () => {
    expect(normalizeEmail("  USER@Example.COM ")).toBe("user@example.com");
    expect(normalizeUsername(" @PLAYER_01 ")).toBe("player_01");
    expect(normalizeUsername(" @IŞIK_İPEK ")).toBe("ışık_ipek");
  });

  it("kullanıcı adı için 3–20 Unicode harf, rakam veya alt çizgi kuralını uygular", () => {
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("abc")).toBe(true);
    expect(isValidUsername("PLAYER_01")).toBe(true);
    expect(isValidUsername("ışık_çayan")).toBe(true);
    expect(isValidUsername("oyuncu-adı")).toBe(false);
    expect(isValidUsername("a".repeat(21))).toBe(false);
  });

  it("Türkçe I/İ/ı/i çiftlerini locale uyumlu ve kararlı normalize eder", () => {
    expect(normalizeUsername("IŞIK")).toBe(normalizeUsername("ışık"));
    expect(normalizeUsername("İPEK")).toBe(normalizeUsername("ipek"));
    expect(normalizeUsername("IŞIK")).not.toBe(normalizeUsername("İŞİK"));
  });

  it("e-posta biçimini ve merkezi uzunluk sınırını uygular", () => {
    expect(isValidEmail("USER@Example.COM")).toBe(true);
    expect(isValidEmail("geçersiz")).toBe(false);
    expect(isValidEmail(`${"a".repeat(250)}@x.test`)).toBe(false);
  });
});

describe("gönderi başlığı", () => {
  it("açık başlığı kullanır, eksik başlığı gövdenin ilk satırından türetir", () => {
    expect(resolvePostTitle("  Akşam rotası  ", "Gövde")).toBe("Akşam rotası");
    expect(resolvePostTitle(undefined, "İlk satır\nİkinci satır")).toBe("İlk satır");
    expect(resolvePostTitle("", "")).toBe("Alan paylaşımı");
  });
});
