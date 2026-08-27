"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AlertCircle, ArrowRight, AtSign, CalendarDays, Check, Eye, EyeOff, Globe2, LockKeyhole, Mail, MapPin, UserRound } from "lucide-react";
import { AccountAvailabilityHint } from "@/components/AccountAvailabilityHint";
import { ColorPalette } from "@/components/ColorPalette";
import { citiesForCountry, DEFAULT_CITY_ID, DEFAULT_COUNTRY_CODE, LOCATION_OPTIONS, ROUTE_COLORS } from "@/lib/app-config";
import { CONTENT_LIMITS } from "@/lib/content-limits";
import { useAccountAvailability } from "@/lib/use-account-availability";
import { normalizeProtectedReturnPath } from "@/lib/safe-navigation";
import { getBirthDateInputBounds } from "@/lib/age-policy";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/legal-consent";
import { TurnstileChallenge, turnstileIsConfiguredForClient } from "@/features/security/turnstile/TurnstileChallenge";
import { useI18n } from "@/i18n/I18nProvider";

type AuthMode = "login" | "register" | "forgot";

export function AuthForm({ mode, initialResetToken = "", initialNext }: { mode: AuthMode; initialResetToken?: string; initialNext?: string }) {
  const { dictionary: copy } = useI18n();
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [color, setColor] = useState<string>(ROUTE_COLORS[0]);
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [cityId, setCityId] = useState(DEFAULT_CITY_ID);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [registrationPendingVerification, setRegistrationPendingVerification] = useState(false);
  const [resetToken, setResetToken] = useState(initialResetToken);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const resetConfirm = mode === "forgot" && Boolean(resetToken);
  const turnstileProtected = mode === "register" || (mode === "forgot" && !resetConfirm);
  const turnstileRequired = turnstileProtected && turnstileIsConfiguredForClient();
  const usernameAvailability = useAccountAvailability("username", username, mode === "register");
  const emailAvailability = useAccountAvailability("email", email, mode === "register");
  const registerIdentityReady = mode !== "register" || (usernameAvailability === "available" && emailAvailability === "available");
  const birthDateBounds = getBirthDateInputBounds();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const values = new FormData(event.currentTarget);
    const endpoint = mode === "register" ? "/api/auth/register" : mode === "forgot" ? "/api/auth/reset" : "/api/auth/login";
    const payload = mode === "register"
      ? {
          displayName: values.get("displayName"), username: values.get("username"), birthDate: values.get("birthDate"),
          email: values.get("email"), password: values.get("password"), color, countryCode, cityId,
          termsAccepted: values.get("termsAccepted") === "on",
          termsVersion: CURRENT_TERMS_VERSION,
          privacyVersion: CURRENT_PRIVACY_VERSION,
          turnstileToken,
        }
      : mode === "forgot"
        ? resetConfirm ? { token: resetToken, newPassword: values.get("password") } : { email: values.get("email"), turnstileToken }
        : { email: values.get("email"), password: values.get("password"), remember: values.get("remember") === "on" };

    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string; developmentToken?: string; completed?: boolean; requiresEmailVerification?: boolean };
      if (!response.ok) throw new Error(result.error || copy.auth.genericError);
      if (mode === "forgot") {
        if (resetConfirm || result.completed) setSent(true);
        else if (result.developmentToken) setResetToken(result.developmentToken);
        else setRequestSent(true);
      } else if (mode === "register" && result.requiresEmailVerification) {
        setRegistrationPendingVerification(true);
      } else {
        router.push(mode === "login" ? normalizeProtectedReturnPath(initialNext) : "/home");
        router.refresh();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.auth.genericError);
      if (turnstileRequired) setTurnstileResetKey((value) => value + 1);
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="auth-success">
        <span><Check size={28} strokeWidth={3} /></span>
        <h1>{copy.auth.resetSuccessTitle}</h1>
        <p>{copy.auth.resetSuccessBody}</p>
        <Link href="/login" className="primary-button">{copy.auth.returnToLoginAction} <ArrowRight size={18} /></Link>
      </div>
    );
  }

  if (requestSent) {
    return (
      <div className="auth-success">
        <span><Check size={28} strokeWidth={3} /></span>
        <h1>{copy.auth.checkEmailTitle}</h1>
        <p>{copy.auth.checkEmailBody}</p>
        <Link href="/login" className="primary-button">{copy.auth.returnToLoginAction} <ArrowRight size={18} /></Link>
      </div>
    );
  }

  if (registrationPendingVerification) {
    return (
      <div className="auth-success">
        <span><Check size={28} strokeWidth={3} /></span>
        <h1>{copy.auth.verifyEmailTitle}</h1>
        <p>{copy.auth.verifyEmailBody}</p>
        <Link href="/login" className="primary-button">{copy.auth.returnToLoginScreenAction} <ArrowRight size={18} /></Link>
      </div>
    );
  }

  const title = mode === "login" ? copy.auth.loginTitle : mode === "register" ? copy.auth.registerTitle : copy.auth.forgotTitle;
  const subtitle = mode === "login" ? copy.auth.loginSubtitle : mode === "register" ? copy.auth.registerSubtitle : resetConfirm ? copy.auth.resetSubtitle : copy.auth.forgotSubtitle;

  return (
    <div className="auth-card">
      <div className="auth-title"><span className="eyebrow">{mode === "register" ? copy.auth.registerEyebrow : mode === "forgot" ? copy.auth.recoveryEyebrow : copy.auth.loginEyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>
      {error ? <div className="form-error" role="alert"><AlertCircle size={17} /> {error}</div> : null}
      <form onSubmit={submit} className="auth-form">
        {mode === "register" ? (
          <>
            <label>{copy.auth.fullName}<div className="input-wrap"><UserRound size={18} /><input name="displayName" type="text" placeholder={copy.auth.fullNamePlaceholder} required autoComplete="name" minLength={CONTENT_LIMITS.displayName.min} maxLength={CONTENT_LIMITS.displayName.max} /></div></label>
            <label>{copy.auth.username}<div className="input-wrap"><AtSign size={18} /><input name="username" type="text" placeholder={copy.auth.usernamePlaceholder} required autoComplete="username" minLength={CONTENT_LIMITS.username.min} maxLength={CONTENT_LIMITS.username.max} value={username} onChange={(event) => setUsername(event.target.value)} aria-describedby="username-availability" /></div><span id="username-availability"><AccountAvailabilityHint status={usernameAvailability} label={copy.auth.username} /></span></label>
            <label>{copy.auth.birthDate}<div className="input-wrap"><CalendarDays size={18} /><input name="birthDate" type="date" required autoComplete="bday" min={birthDateBounds.min} max={birthDateBounds.max} /></div></label>
            <div className="auth-location-fields">
              <label>{copy.common.country}<div className="input-wrap"><Globe2 size={18} /><select name="countryCode" value={countryCode} onChange={(event) => { const nextCountryCode = event.target.value; setCountryCode(nextCountryCode); setCityId(citiesForCountry(nextCountryCode)[0]?.id ?? ""); }} required>{LOCATION_OPTIONS.map((location) => <option key={location.code} value={location.code}>{location.label}</option>)}</select></div></label>
              <label>{copy.common.city}<div className="input-wrap"><MapPin size={18} /><select name="cityId" value={cityId} onChange={(event) => setCityId(event.target.value)} required>{citiesForCountry(countryCode).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div></label>
            </div>
          </>
        ) : null}
        {!resetConfirm ? <label>{copy.auth.email}<div className="input-wrap"><Mail size={18} /><input name="email" type="email" placeholder={copy.auth.emailPlaceholder} required autoComplete="email" maxLength={CONTENT_LIMITS.email.max} value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby={mode === "register" ? "email-availability" : undefined} /></div>{mode === "register" ? <span id="email-availability"><AccountAvailabilityHint status={emailAvailability} label={copy.auth.email} /></span> : null}</label> : null}
        {mode !== "forgot" || resetConfirm ? <label>{mode === "forgot" ? copy.auth.newPassword : copy.auth.password}<div className="input-wrap"><LockKeyhole size={18} /><input name="password" type={showPassword ? "text" : "password"} placeholder={mode === "login" ? copy.auth.passwordPlaceholder : copy.auth.strongPasswordPlaceholder} required minLength={CONTENT_LIMITS.password.min} maxLength={CONTENT_LIMITS.password.max} autoComplete={mode === "login" ? "current-password" : "new-password"} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? copy.auth.hidePassword : copy.auth.showPassword}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label> : null}

        {mode === "register" ? (
          <fieldset className="color-picker-fieldset">
            <legend className="visually-hidden">{copy.auth.gameColor}</legend>
            <ColorPalette value={color} onChange={setColor} label={copy.auth.gameColor} helper={copy.auth.paletteHint} />
            <p>{copy.auth.colorIdentityHint}</p>
          </fieldset>
        ) : null}

        {mode === "login" ? <div className="auth-options"><label><input name="remember" type="checkbox" defaultChecked /> {copy.auth.rememberMe}</label><Link href="/forgot-password">{copy.auth.forgotPassword}</Link></div> : null}
        {mode === "register" ? <label className="terms-check"><input name="termsAccepted" type="checkbox" required /><span><Link href="/terms">{copy.auth.termsPrefix}</Link> ve <Link href="/privacy">{copy.auth.privacyPolicy}</Link> {copy.auth.consentSuffix}</span></label> : null}
        {turnstileProtected ? <TurnstileChallenge action={mode === "register" ? "register" : "password_reset"} onTokenChange={setTurnstileToken} resetKey={turnstileResetKey} /> : null}
        <button type="submit" className="auth-submit" disabled={pending || !registerIdentityReady || (turnstileRequired && !turnstileToken)}>{pending ? copy.auth.processing : mode === "login" ? copy.auth.login : mode === "register" ? copy.auth.createAccount : resetConfirm ? copy.auth.renewPassword : copy.auth.sendSecureLink}<ArrowRight size={18} /></button>
      </form>
      <p className="auth-switch">
        {mode === "login" ? <>{copy.auth.noAccount} <Link href="/register">{copy.auth.joinNow}</Link></> : mode === "register" ? <>{copy.auth.alreadyAccount} <Link href="/login">{copy.auth.login}</Link></> : <Link href="/login">← {copy.auth.returnToLoginScreenAction}</Link>}
      </p>
      <Link href="/demo/home" className="demo-entry-link">{copy.auth.exploreDemo} <ArrowRight size={15} /></Link>
    </div>
  );
}
