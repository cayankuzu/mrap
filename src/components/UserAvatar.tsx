import Link from "next/link";
import type { AppUser, PublicPlayer } from "@/lib/models";
import { readableTextColor } from "@/lib/app-config";

type AvatarUser = Pick<AppUser | PublicPlayer, "displayName" | "initials" | "color" | "avatarData">;

export function UserAvatar({ user, size = "md", href, className = "" }: { user: AvatarUser; size?: "sm" | "md" | "lg" | "xl"; href?: string; className?: string }) {
  const classes = `avatar avatar--${size}${user.avatarData ? " has-image" : ""}${className ? ` ${className}` : ""}`;
  const style = { "--avatar-color": user.color, "--avatar-text-color": readableTextColor(user.color), ...(user.avatarData ? { backgroundImage: `url(${user.avatarData})` } : {}) } as React.CSSProperties;
  const content = <span aria-hidden={user.avatarData ? "true" : undefined}>{user.avatarData ? "" : user.initials}</span>;
  return href
    ? <Link href={href} className={classes} style={style} aria-label={`${user.displayName} profilini aç`}>{content}</Link>
    : <span className={classes} style={style} role="img" aria-label={`${user.displayName} profil görseli`}>{content}</span>;
}
