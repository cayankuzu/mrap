"use client";

import { Check, Clock3, UserPlus } from "lucide-react";
import { useRef, useState } from "react";

type Relation = "none" | "following" | "requested";

export function FollowButton({ userId, initialRelation }: { userId: string; initialRelation: Relation }) {
  const [relation, setRelation] = useState(initialRelation);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);

  async function toggle() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/follows/${encodeURIComponent(userId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desired: relation === "none" }),
      });
      const result = await response.json().catch(() => null) as { status?: Relation; error?: string } | null;
      if (!response.ok || !result?.status) {
        setError(result?.error || "Takip işlemi tamamlanamadı.");
        return;
      }
      setRelation(result.status);
    } catch {
      setError("Takip işlemi tamamlanamadı. Bağlantını kontrol edip yeniden dene.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return <div className="follow-profile-control">
    <button type="button" className={`primary-button follow-profile-button${relation !== "none" ? " is-active" : ""}`} onClick={() => void toggle()} disabled={pending} aria-busy={pending}>{relation === "following" ? <Check size={17} /> : relation === "requested" ? <Clock3 size={17} /> : <UserPlus size={17} />}{pending ? "İşleniyor…" : relation === "following" ? "Takiptesin" : relation === "requested" ? "İstek gönderildi" : "Takip et"}</button>
    {error ? <span className="follow-profile-error" role="alert">{error}</span> : null}
  </div>;
}
