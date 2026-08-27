import { clearActiveRouteSession, type SessionStorageLike } from "@/lib/game/session-recovery";
import { clearOfflineRouteDraft } from "@/lib/game/offline-route-draft";
import { clearRoutePointQueue } from "@/lib/game/route-point-queue";
import { postComposerDraftKey } from "@/lib/post-composer-draft";

type MutableClientStorage = Pick<Storage, "removeItem">;

/** Remove only the authenticated user's device-local private state. */
export function clearPrivateClientState(
  storages: { sessionStorage: SessionStorageLike; localStorage: MutableClientStorage },
  userId: string,
) {
  clearActiveRouteSession(storages.sessionStorage, userId);
  clearOfflineRouteDraft(storages.sessionStorage, userId);
  clearRoutePointQueue(storages.sessionStorage, userId);
  try { storages.sessionStorage.removeItem(postComposerDraftKey(userId)); } catch { /* Best effort. */ }
  try { storages.localStorage.removeItem(`mrap:route-color:${userId}`); } catch { /* Best effort. */ }
}
