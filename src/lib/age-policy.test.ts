import { describe, expect, it } from "vitest";
import { calculateAge, getBirthDateInputBounds, isEligibleBirthDate } from "@/lib/age-policy";

const today = new Date("2026-08-27T12:00:00.000Z");

describe("hesap yaş politikası", () => {
  it("13 ve 100 yaş sınır günlerini kabul eder", () => {
    expect(isEligibleBirthDate("2013-08-27", today)).toBe(true);
    expect(isEligibleBirthDate("1925-08-28", today)).toBe(true);
  });

  it("bir gün küçük ve bir gün fazla yaşlı tarihleri reddeder", () => {
    expect(isEligibleBirthDate("2013-08-28", today)).toBe(false);
    expect(isEligibleBirthDate("1925-08-27", today)).toBe(false);
  });

  it("HTML tarih sınırlarını aynı kuralla üretir", () => {
    expect(getBirthDateInputBounds(today)).toEqual({ min: "1925-08-28", max: "2013-08-27" });
  });

  it("29 Şubat doğum gününü UTC takviminde deterministik hesaplar", () => {
    const birth = new Date("2012-02-29T00:00:00.000Z");
    expect(calculateAge(birth, new Date("2025-02-28T12:00:00.000Z"))).toBe(12);
    expect(calculateAge(birth, new Date("2025-03-01T00:00:00.000Z"))).toBe(13);
  });
});
