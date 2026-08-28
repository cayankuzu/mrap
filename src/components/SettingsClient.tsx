"use client";

import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Check,
  Globe2,
  ImagePlus,
  LockKeyhole,
  Mail,
  MapPin,
  Palette,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { AccountAvailabilityHint } from "@/components/AccountAvailabilityHint";
import { ColorPalette } from "@/components/ColorPalette";
import { LocationFields } from "@/components/LocationFields";
import { UserAvatar } from "@/components/UserAvatar";
import { readableTextColor } from "@/lib/app-config";
import { optimizeImage } from "@/lib/client-image";
import { CONTENT_LIMITS } from "@/lib/content-limits";
import { getBirthDateInputBounds } from "@/lib/age-policy";
import type { AppUser } from "@/lib/models";
import { useAccountAvailability, type AvailabilityStatus } from "@/lib/use-account-availability";
import { useModalDialog } from "@/lib/use-modal-dialog";
import { clearPrivateClientState } from "@/lib/private-client-state";
import { useI18n } from "@/i18n/I18nProvider";

export type ProfileSaveInput = {
  username: string;
  displayName: string;
  countryCode: string;
  cityId: string;
  country: string;
  city: string;
  birthDate: string;
  bio: string;
  color: string;
  accountVisibility: AppUser["accountVisibility"];
  locationVisibility: AppUser["locationVisibility"];
  avatarData: string | null;
  coverData: string | null;
};

export type ProfileSaveResult = { user?: AppUser; error?: string };
type SettingsSection = "profile" | "preferences";

type SettingsClientProps = {
  initialUser: AppUser;
  saveProfile?: (input: ProfileSaveInput) => Promise<ProfileSaveResult>;
  resolveUsernameAvailability?: (username: string) => AvailabilityStatus;
  resetDemo?: () => AppUser;
};

export function SettingsClient({ initialUser, saveProfile, resolveUsernameAvailability, resetDemo }: SettingsClientProps) {
  const { dictionary: copy } = useI18n();
  const router = useRouter();
  const birthDateBounds = getBirthDateInputBounds();
  const [activeSection, setActiveSection] = useState<SettingsSection>("profile");
  const [user, setUser] = useState(initialUser);
  const [username, setUsername] = useState(initialUser.username);
  const [displayName, setDisplayName] = useState(initialUser.displayName);
  const [birthDate, setBirthDate] = useState(initialUser.birthDate);
  const [bio, setBio] = useState(initialUser.bio);
  const [color, setColor] = useState(initialUser.color);
  const [countryCode, setCountryCode] = useState(initialUser.countryCode);
  const [cityId, setCityId] = useState(initialUser.cityId);
  const [country, setCountry] = useState(initialUser.country);
  const [city, setCity] = useState(initialUser.city);
  const [accountVisibility, setAccountVisibility] = useState<AppUser["accountVisibility"]>(initialUser.accountVisibility);
  const [avatarData, setAvatarData] = useState(initialUser.avatarData);
  const [coverData, setCoverData] = useState(initialUser.coverData);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [dangerConfirmation, setDangerConfirmation] = useState("");
  const [dangerPassword, setDangerPassword] = useState("");
  const [dangerAcknowledged, setDangerAcknowledged] = useState(false);
  const [dangerStatus, setDangerStatus] = useState("");
  const [dangerPending, setDangerPending] = useState(false);
  const dangerSubmissionRef = useRef(false);
  const dangerDialogRef = useRef<HTMLElement>(null);
  const remoteUsernameAvailability = useAccountAvailability("username", username, !resolveUsernameAvailability);
  const usernameAvailability = resolveUsernameAvailability?.(username) ?? remoteUsernameAvailability;
  const demoMode = Boolean(resetDemo);
  const requiredConfirmation = demoMode ? "SIFIRLA" : user.username;
  const confirmationMatches = dangerConfirmation === requiredConfirmation;
  const dangerActionReady = demoMode
    ? confirmationMatches
    : confirmationMatches && dangerAcknowledged && dangerPassword.length > 0;

  useModalDialog(dangerOpen, closeDangerDialog, dangerDialogRef);

  function closeDangerDialog() {
    if (dangerSubmissionRef.current) return;
    setDangerOpen(false);
    setDangerPassword("");
    setDangerAcknowledged(false);
  }

  function applyUser(nextUser: AppUser) {
    setUser(nextUser);
    setUsername(nextUser.username);
    setDisplayName(nextUser.displayName);
    setBirthDate(nextUser.birthDate);
    setBio(nextUser.bio);
    setColor(nextUser.color);
    setCountryCode(nextUser.countryCode);
    setCityId(nextUser.cityId);
    setCountry(nextUser.country);
    setCity(nextUser.city);
    setAccountVisibility(nextUser.accountVisibility);
    setAvatarData(nextUser.avatarData);
    setCoverData(nextUser.coverData);
  }

  async function readProfileImage(event: ChangeEvent<HTMLInputElement>, target: "avatar" | "cover") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const image = await optimizeImage(file, { maxBytes: 420_000, maxDimension: target === "avatar" ? 900 : 1_800 });
      if (target === "avatar") setAvatarData(image); else setCoverData(image);
      setStatus("Görsel hazır. Kaydettiğinde profilin güncellenecek.");
    } catch (imageError) {
      setStatus(imageError instanceof Error ? imageError.message : "Görsel işlenemedi.");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatus("");
    const input: ProfileSaveInput = {
      username: activeSection === "profile" ? username : user.username,
      displayName: activeSection === "profile" ? displayName : user.displayName,
      countryCode: activeSection === "profile" ? countryCode : user.countryCode,
      cityId: activeSection === "profile" ? cityId : user.cityId,
      country: activeSection === "profile" ? country : user.country,
      city: activeSection === "profile" ? city : user.city,
      birthDate: activeSection === "profile" ? birthDate : user.birthDate,
      bio: activeSection === "profile" ? bio : user.bio,
      color: activeSection === "preferences" ? color : user.color,
      accountVisibility: activeSection === "preferences" ? accountVisibility : user.accountVisibility,
      locationVisibility: "private",
      avatarData: activeSection === "profile" ? avatarData : user.avatarData,
      coverData: activeSection === "profile" ? coverData : user.coverData,
    };
    try {
      let result: ProfileSaveResult;
      let successful = true;
      if (saveProfile) {
        result = await saveProfile(input);
      } else {
        const response = await fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        successful = response.ok;
        result = await response.json() as ProfileSaveResult;
      }
      if (!successful || !result.user) {
        setStatus(result.error || copy.errors.saveFailed);
        return;
      }
      setUser(result.user);
      if (activeSection === "profile") {
        setUsername(result.user.username);
        setDisplayName(result.user.displayName);
        setBirthDate(result.user.birthDate);
        setBio(result.user.bio);
        setCountryCode(result.user.countryCode);
        setCityId(result.user.cityId);
        setCountry(result.user.country);
        setCity(result.user.city);
        setAvatarData(result.user.avatarData);
        setCoverData(result.user.coverData);
      } else {
        setColor(result.user.color);
        setAccountVisibility(result.user.accountVisibility);
      }
      if (activeSection === "preferences") {
        try { window.localStorage.setItem(`mrap:route-color:${result.user.id}`, result.user.color); }
        catch { /* Depolama kapalıysa sunucudaki varsayılan renk yine kaydedilmiştir. */ }
      }
      setStatus(activeSection === "profile" ? copy.settings.profileSaved : copy.settings.settingsSaved);
    } catch {
      setStatus("Değişiklikler kaydedilirken bağlantı hatası oluştu.");
    } finally {
      setPending(false);
    }
  }

  function openDangerDialog() {
    dangerSubmissionRef.current = false;
    setDangerConfirmation("");
    setDangerPassword("");
    setDangerAcknowledged(false);
    setDangerStatus("");
    setDangerOpen(true);
  }

  async function completeDangerAction() {
    if (!dangerActionReady || dangerSubmissionRef.current) return;
    dangerSubmissionRef.current = true;
    setDangerPending(true);
    setDangerStatus("");

    if (resetDemo) {
      const resetUser = resetDemo();
      applyUser(resetUser);
      dangerSubmissionRef.current = false;
      setDangerOpen(false);
      setDangerPending(false);
      setStatus("Demo profilin ve yerel demo tercihlerin sıfırlandı.");
      return;
    }

    let completed = false;
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: dangerConfirmation, acknowledged: dangerAcknowledged, password: dangerPassword }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setDangerPassword("");
        setDangerStatus(result.error || "Hesap silinemedi.");
        return;
      }
      completed = true;
      clearPrivateClientState({ sessionStorage: window.sessionStorage, localStorage: window.localStorage }, user.id);
      router.replace("/login?hesap=silindi");
      router.refresh();
    } catch {
      setDangerPassword("");
      setDangerStatus("Hesap silinirken bağlantı hatası oluştu.");
    } finally {
      if (!completed) {
        dangerSubmissionRef.current = false;
        setDangerPending(false);
      }
    }
  }

  const previewUser = { ...user, username, displayName, color, avatarData };

  return (
    <div className="settings-workspace">
      <div className="settings-section-tabs" role="tablist" aria-label={copy.settings.sectionsAria}>
        <button
          id="settings-profile-tab"
          type="button"
          role="tab"
          aria-selected={activeSection === "profile"}
          aria-controls="settings-profile-panel"
          className={activeSection === "profile" ? "is-active" : ""}
          onClick={() => { setActiveSection("profile"); setStatus(""); }}
        >
          <UserRound size={18} />
          <span><strong>{copy.profile.editProfile}</strong><small>{copy.profile.profileDetails}</small></span>
        </button>
        <button
          id="settings-preferences-tab"
          type="button"
          role="tab"
          aria-selected={activeSection === "preferences"}
          aria-controls="settings-preferences-panel"
          className={activeSection === "preferences" ? "is-active" : ""}
          onClick={() => { setActiveSection("preferences"); setStatus(""); }}
        >
          <Settings2 size={18} />
          <span><strong>{copy.settings.preferences}</strong><small>{copy.settings.preferencesDetails}</small></span>
        </button>
      </div>

      <div
        id={`settings-${activeSection}-panel`}
        role="tabpanel"
        aria-labelledby={`settings-${activeSection}-tab`}
      >
      <form className={`settings-grid settings-panel-grid is-${activeSection}`} onSubmit={save}>
        {activeSection === "profile" ? (
          <>
            <section className="settings-card settings-media-card">
              <header><span><Camera size={20} /></span><div><h2>{copy.settings.profileAppearance}</h2><p>{copy.settings.profileAppearanceHint}</p></div></header>
              <div className="settings-cover-preview" style={coverData ? { backgroundImage: `url(${coverData})` } : undefined}>
                <div className={`profile-pattern pattern-${user.pattern}`} style={{ "--profile-color": color } as React.CSSProperties}><span>@{username} · @{username}</span></div>
                <UserAvatar user={previewUser} size="xl" />
              </div>
              <div className="settings-media-actions">
                <label className="secondary-button"><ImagePlus size={17} /> Profil fotoğrafı<input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => readProfileImage(event, "avatar")} /></label>
                <label className="secondary-button"><ImagePlus size={17} /> Kapak fotoğrafı<input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => readProfileImage(event, "cover")} /></label>
                {avatarData ? <button type="button" className="text-button" onClick={() => setAvatarData(null)}><X size={15} /> Profili kaldır</button> : null}
                {coverData ? <button type="button" className="text-button" onClick={() => setCoverData(null)}><X size={15} /> Kapağı kaldır</button> : null}
              </div>
            </section>

            <section className="settings-card settings-profile-information">
              <header><span><UserRound size={20} /></span><div><h2>{copy.settings.profileInformation}</h2><p>{copy.settings.emailImmutableHint}</p></div></header>
              <div className="settings-fields">
                <label>Ad soyad<input name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={CONTENT_LIMITS.displayName.min} maxLength={CONTENT_LIMITS.displayName.max} required /></label>
                <label>Kullanıcı adı<input name="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={CONTENT_LIMITS.username.min} maxLength={CONTENT_LIMITS.username.max} aria-describedby="settings-username-availability" required /><span id="settings-username-availability"><AccountAvailabilityHint status={usernameAvailability} label="Kullanıcı adı" /></span></label>
                <label className="readonly-field"><span>E-posta <Mail size={13} /></span><input value={user.email} readOnly aria-label="E-posta adresi" /></label>
                <label>Doğum tarihi<input name="birthDate" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} min={birthDateBounds.min} max={birthDateBounds.max} required /></label>
                <div className="full-field">
                  <LocationFields
                    key={countryCode}
                    compact
                    countryCode={countryCode}
                    cityId={cityId}
                    countryLabel={country}
                    cityLabel={city}
                    onCountryChange={(code, label) => { setCountryCode(code); setCountry(label); }}
                    onCityChange={(id, label) => { setCityId(id); setCity(label); }}
                  />
                </div>
                <label className="full-field">Kısa biyografi<textarea name="bio" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={CONTENT_LIMITS.bio.max} placeholder="Rotana eşlik eden kısa hikâye…" /></label>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="settings-card settings-route-color-card">
              <header><span><Palette size={20} /></span><div><h2>{copy.settings.defaultRouteColor}</h2><p>{copy.settings.defaultRouteColorHint}</p></div></header>
              <ColorPalette value={color} onChange={setColor} label="Rota rengin" helper="36 uyumlu renk" className="settings-route-palette" />
              <div className="settings-route-preview" style={{ "--preview-color": color, "--preview-text": readableTextColor(color) } as React.CSSProperties}>
                <span className="settings-route-swatch"><i>@{username}</i></span>
                <span><strong>{color.toLocaleUpperCase("tr-TR")}</strong><small>Rota ve yeni alanların için varsayılan seçim</small></span>
              </div>
            </section>

            <section className="settings-card">
              <header><span><ShieldCheck size={20} /></span><div><h2>{copy.settings.accountPrivacy}</h2><p>{copy.settings.accountPrivacyHint}</p></div></header>
              <div className="visibility-options">
                {([
                  { id: "public", icon: Globe2, title: "Herkese açık hesap", text: "Takip doğrudan başlar; profilin keşfedilebilir." },
                  { id: "private", icon: LockKeyhole, title: "Gizli hesap", text: "Yeni takipçiler için onayın gerekir." },
                ] as const).map(({ id, icon: Icon, title, text }) => (
                  <button key={id} type="button" className={accountVisibility === id ? "is-selected" : ""} onClick={() => setAccountVisibility(id)}>
                    <Icon size={19} /><span><strong>{title}</strong><small>{text}</small></span>{accountVisibility === id ? <Check size={16} /> : null}
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-card settings-location-privacy-card">
              <header><span><MapPin size={20} /></span><div><h2>{copy.settings.locationPrivacy}</h2><p>{copy.settings.locationPrivacyHint}</p></div></header>
              <div className="settings-privacy-lock">
                <span><LockKeyhole size={19} /></span>
                <div><strong>{copy.settings.fullyPrivate}</strong><small>Canlı GPS noktan ve çizmekte olduğun rota hiçbir kullanıcıya yayınlanmaz.</small></div>
                <Check size={17} aria-hidden="true" />
              </div>
              <div className="settings-safety-note"><ShieldCheck size={17} /><span>Diğer oyuncular yalnızca başarıyla kapattığın alanı görür. Bu güvenlik ayarı değiştirilemez.</span></div>
            </section>

            <section className={`settings-card settings-danger-card${demoMode ? " is-demo" : ""}`}>
              <header><span>{demoMode ? <RotateCcw size={20} /> : <Trash2 size={20} />}</span><div><h2>{demoMode ? copy.settings.resetDemo : copy.settings.deleteAccount}</h2><p>{demoMode ? "Yalnızca bu tarayıcıdaki demo profil tercihlerini başlangıç durumuna döndürür." : "Profilin, gönderilerin, alanların ve bütün hesap verilerin kalıcı olarak silinir."}</p></div></header>
              <button type="button" className={demoMode ? "secondary-button" : "danger-button"} onClick={openDangerDialog}>
                {demoMode ? <RotateCcw size={17} /> : <Trash2 size={17} />}
                {demoMode ? "Demo profilini sıfırla" : "Hesabı kalıcı olarak sil"}
              </button>
            </section>
          </>
        )}

        <div className="settings-savebar">
          <span role="status" aria-live="polite">{status}</span>
          <button type="submit" className="primary-button" disabled={pending || activeSection === "profile" && (usernameAvailability !== "available" || !cityId)}>
            <Save size={18} /> {pending ? copy.common.saving : activeSection === "profile" ? copy.settings.saveProfile : copy.settings.saveSettings}
          </button>
        </div>
      </form>
      </div>

      {dangerOpen ? (
        <div className="modal-backdrop settings-danger-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDangerDialog(); }}>
          <section ref={dangerDialogRef} className="settings-danger-dialog" role="dialog" aria-modal="true" aria-labelledby="danger-dialog-title" aria-describedby="danger-dialog-description" tabIndex={-1}>
            <button type="button" className="modal-close" aria-label="Onay penceresini kapat" onClick={closeDangerDialog} disabled={dangerPending}><X size={18} /></button>
            <span className="settings-danger-icon">{demoMode ? <RotateCcw size={24} /> : <Trash2 size={24} />}</span>
            <h2 id="danger-dialog-title">{demoMode ? "Demo profilini sıfırla" : "Hesabını kalıcı olarak sil"}</h2>
            <p id="danger-dialog-description">{demoMode ? "Bu işlem gerçek bir hesabı etkilemez. Demo profilin ve renk tercihin başlangıç durumuna döner." : "Bu işlem geri alınamaz. Alanların, paylaşımların, fotoğrafların, bağlantıların ve oturumların tamamen kaldırılır."}</p>
            <label>
              Devam etmek için <strong>{requiredConfirmation}</strong> yaz
              <input value={dangerConfirmation} onChange={(event) => setDangerConfirmation(event.target.value)} autoComplete="off" autoCapitalize="none" maxLength={CONTENT_LIMITS.username.max} spellCheck={false} disabled={dangerPending} />
            </label>
            {!demoMode ? <>
              <label>
                Mevcut şifren
                <input type="password" value={dangerPassword} onChange={(event) => setDangerPassword(event.target.value)} autoComplete="current-password" maxLength={CONTENT_LIMITS.password.max} disabled={dangerPending} />
              </label>
              <label className="settings-danger-acknowledgement">
                <input type="checkbox" checked={dangerAcknowledged} onChange={(event) => setDangerAcknowledged(event.target.checked)} disabled={dangerPending} />
                <span>Bu işlemin geri alınamayacağını ve tüm hesap verilerimin kalıcı olarak silineceğini anlıyorum.</span>
              </label>
            </> : null}
            <span className="settings-danger-status" role="status" aria-live="polite">{dangerStatus}</span>
            <div className="settings-danger-actions">
              <button type="button" className="secondary-button" onClick={closeDangerDialog} disabled={dangerPending}>Vazgeç</button>
              <button type="button" className={demoMode ? "primary-button" : "danger-button"} onClick={completeDangerAction} disabled={!dangerActionReady || dangerPending}>
                {dangerPending ? "İşleniyor…" : demoMode ? "Demoyu sıfırla" : "Hesabımı sil"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
