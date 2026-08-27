import legalPolicy from "@/config/legal-policy.json";

export const CURRENT_TERMS_VERSION = legalPolicy.termsVersion;
export const CURRENT_PRIVACY_VERSION = legalPolicy.privacyVersion;

export function hasCurrentLegalConsent(value: {
  termsAccepted?: unknown;
  termsVersion?: unknown;
  privacyVersion?: unknown;
}) {
  return value.termsAccepted === true
    && value.termsVersion === CURRENT_TERMS_VERSION
    && value.privacyVersion === CURRENT_PRIVACY_VERSION;
}
