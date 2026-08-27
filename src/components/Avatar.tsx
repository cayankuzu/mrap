import type { User } from "@/lib/data";
import { readableTextColor } from "@/lib/app-config";

export function Avatar({ user, size = "md" }: { user: User; size?: "sm" | "md" | "lg" | "xl" }) {
  return (
    <span
      className={`avatar avatar--${size}`}
      style={{ "--avatar-color": user.color, "--avatar-text-color": readableTextColor(user.color) } as React.CSSProperties}
      aria-label={`${user.name} profil görseli`}
      role="img"
    >
      {user.initials}
    </span>
  );
}
