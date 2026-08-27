import { describe, expect, it } from "vitest";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, hasCurrentLegalConsent } from "@/lib/legal-consent";

describe("sürümlü yasal onay", () => {
  it("yalnızca açık onay ve iki güncel politika sürümüyle kabul eder", () => {
    expect(hasCurrentLegalConsent({ termsAccepted: true, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION })).toBe(true);
    expect(hasCurrentLegalConsent({ termsAccepted: false, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION })).toBe(false);
    expect(hasCurrentLegalConsent({ termsAccepted: true, termsVersion: "eski", privacyVersion: CURRENT_PRIVACY_VERSION })).toBe(false);
  });
});
