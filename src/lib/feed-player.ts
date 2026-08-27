import type { FeedPlayer } from "@/lib/models";
import { userMediaReference } from "@/lib/user-media-reference";

type FeedPlayerSource = Omit<FeedPlayer, "avatarData"> & { avatarData: string | null };

/** Prevents persisted base64 profile media from entering feed RSC/API payloads. */
export function toFeedPlayerReference(user: FeedPlayerSource): FeedPlayer {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    initials: user.initials,
    color: user.color,
    pattern: user.pattern,
    avatarData: userMediaReference(user.id, "avatar", Boolean(user.avatarData)),
  };
}
