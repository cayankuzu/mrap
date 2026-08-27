"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { LogOut, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  confirmTone?: "danger" | "primary";
  icon?: ReactNode;
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationDialog({ open, title, description, confirmLabel, pendingLabel = "İşlem yapılıyor…", confirmTone = "danger", icon, pending = false, error, onCancel, onConfirm }: ConfirmationDialogProps) {
  const { dictionary: copy } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => cancelRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && dialogRef.current?.dataset.pending !== "true") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onCancel, open]);

  if (!open) return null;

  return <div className="modal-backdrop confirmation-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onCancel(); }}>
    <div ref={dialogRef} className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} data-pending={pending}>
      <button ref={cancelRef} type="button" className="confirmation-close" onClick={onCancel} disabled={pending} aria-label={copy.dialogs.closeConfirmation}><X size={18} /></button>
      <span className="confirmation-icon" aria-hidden="true">{icon ?? <LogOut size={22} />}</span>
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {error ? <p className="confirmation-error" role="alert">{error}</p> : null}
      <div className="confirmation-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={pending}>{copy.common.cancel}</button>
        <button type="button" className={confirmTone === "danger" ? "danger-button" : "primary-button"} onClick={onConfirm} disabled={pending}>{pending ? pendingLabel : confirmLabel}</button>
      </div>
    </div>
  </div>;
}
