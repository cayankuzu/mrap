"use client";

import Link from "next/link";
import { Heart, RefreshCw } from "lucide-react";
import { MediaLightbox } from "@/components/MediaLightbox";
import { UserAvatar } from "@/components/UserAvatar";
import { formatMessage } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";

export type LikeListUser = {
  id: string;
  username: string;
  displayName: string;
  initials: string;
  color: string;
  avatarData: string | null;
};

export function PostLikesDialog({ open, onClose, users, total, loading = false, error = "", onRetry, profilePrefix = "/users" }: { open: boolean; onClose: () => void; users: LikeListUser[]; total: number; loading?: boolean; error?: string; onRetry?: () => void | Promise<void>; profilePrefix?: string }) {
  const { dictionary: copy } = useI18n();
  return (
    <MediaLightbox open={open} onClose={onClose} title={`${copy.social.likes} · ${total}`} className="post-likes-dialog" closeLabel={copy.social.likesPanelClose}>
      <div className="post-likes-content">
        {loading ? <div className="post-likes-state" role="status"><span className="post-likes-spinner" /> {copy.social.likesLoading}</div> : error ? <div className="post-likes-state is-error" role="alert"><span>{error}</span>{onRetry ? <button type="button" className="post-likes-retry" onClick={() => void onRetry()}><RefreshCw size={15} /> {copy.common.retry}</button> : null}</div> : users.length ? (
          <><ul className="post-likes-list">
            {users.map((user) => <li key={user.id}><UserAvatar user={user} href={`${profilePrefix}/${user.username}`} /><Link href={`${profilePrefix}/${user.username}`}><strong>{user.displayName}</strong><span>@{user.username}</span></Link><Heart size={16} fill="currentColor" aria-hidden="true" /></li>)}
          </ul>{users.length < total ? <p className="post-likes-more">{formatMessage(copy.social.moreLikes, { count: total - users.length })}</p> : null}</>
        ) : <div className="post-likes-state"><Heart size={24} /> {copy.social.noLikes}</div>}
      </div>
    </MediaLightbox>
  );
}
