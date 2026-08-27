import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

export function SystemState({
  eyebrow,
  title,
  description,
  icon,
  children,
  loading = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: ReactNode;
  children?: ReactNode;
  loading?: boolean;
}) {
  return (
    <main className="system-state-page" aria-busy={loading || undefined}>
      <section className="system-state-card" role={loading ? "status" : undefined} aria-live={loading ? "polite" : undefined}>
        <Logo />
        <span className={`system-state-icon${loading ? " is-loading" : ""}`} aria-hidden="true">{icon}</span>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {children ? <div className="system-state-actions">{children}</div> : null}
      </section>
    </main>
  );
}
