"use client";

import Image from "next/image";
import { Maximize2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { MediaLightbox } from "@/components/MediaLightbox";
import { UserAvatar } from "@/components/UserAvatar";
import type { AppUser, PublicPlayer } from "@/lib/models";

type ProfileMediaUser = Pick<
  AppUser | PublicPlayer,
  "avatarData" | "coverData" | "color" | "displayName" | "initials" | "pattern" | "username"
>;

type ProfileCoverMediaProps = {
  user: ProfileMediaUser;
  variant?: "hero" | "settings";
  children?: ReactNode;
};

export function ProfileCoverMedia({ user, variant = "hero", children }: ProfileCoverMediaProps) {
  const [open, setOpen] = useState(false);
  const dialogId = `profile-cover-${useId().replace(/:/g, "")}`;
  const rootClassName = variant === "settings" ? "settings-cover-preview" : "profile-cover real-profile-cover";
  const title = `${user.displayName} kapak fotoğrafı`;

  return (
    <>
      <div className={rootClassName} style={{ "--profile-color": user.color } as React.CSSProperties}>
        {user.coverData ? (
          <button
            type="button"
            className="profile-cover-trigger"
            onClick={() => setOpen(true)}
            aria-label={`${title}nı büyüt`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={dialogId}
          >
            <Image src={user.coverData} alt="" fill unoptimized sizes="(max-width: 760px) 100vw, 1030px" />
            <span className="profile-media-expand-badge" aria-hidden="true"><Maximize2 size={16} /></span>
          </button>
        ) : (
          <div className={`profile-pattern pattern-${user.pattern}`}>
            <span>@{user.username} · @{user.username} · @{user.username}</span>
          </div>
        )}
        {children}
      </div>
      <MediaLightbox open={open} onClose={() => setOpen(false)} title={title} className="profile-media-dialog" closeLabel="Kapak fotoğrafını kapat" dialogId={dialogId}>
        {user.coverData ? <div className="lightbox-photo profile-media-lightbox-photo"><Image src={user.coverData} alt={`${title} büyütülmüş görünüm`} fill unoptimized sizes="94vw" /></div> : null}
      </MediaLightbox>
    </>
  );
}

export function ProfileAvatarMedia({ user }: { user: ProfileMediaUser }) {
  const [open, setOpen] = useState(false);
  const dialogId = `profile-avatar-${useId().replace(/:/g, "")}`;

  if (!user.avatarData) return <UserAvatar user={user} size="xl" />;

  const title = `${user.displayName} profil fotoğrafı`;
  return (
    <>
      <button
        type="button"
        className="profile-avatar-trigger"
        onClick={() => setOpen(true)}
        aria-label={`${title}nı büyüt`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
      >
        <UserAvatar user={user} size="xl" />
        <span className="profile-media-expand-badge" aria-hidden="true"><Maximize2 size={13} /></span>
      </button>
      <MediaLightbox open={open} onClose={() => setOpen(false)} title={title} className="profile-media-dialog is-avatar" closeLabel="Profil fotoğrafını kapat" dialogId={dialogId}>
        <div className="lightbox-photo profile-media-lightbox-photo is-avatar"><Image src={user.avatarData} alt={`${title} büyütülmüş görünüm`} fill unoptimized sizes="min(94vw, 720px)" /></div>
      </MediaLightbox>
    </>
  );
}
