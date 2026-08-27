import { CONTENT_LIMITS } from "@/lib/content-limits";

const DRAFT_VERSION = 1;
const TERRITORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type PostComposerDraft = {
  title: string;
  body: string;
  territoryId: string;
};

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function postComposerDraftKey(userId: string) {
  return `mrap:post-draft:${encodeURIComponent(userId)}`;
}

export function readPostComposerDraft(storage: DraftStorage, key: string): PostComposerDraft | null {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 5_000) return null;
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as { v?: unknown; title?: unknown; body?: unknown; territoryId?: unknown };
    if (Object.keys(value).some((field) => !["v", "title", "body", "territoryId"].includes(field))) return null;
    if (candidate.v !== DRAFT_VERSION || typeof candidate.title !== "string" || typeof candidate.body !== "string" || typeof candidate.territoryId !== "string") return null;
    if (candidate.title.length > CONTENT_LIMITS.postTitle.max || candidate.body.length > CONTENT_LIMITS.postBody.max) return null;
    if (candidate.territoryId && !TERRITORY_ID_PATTERN.test(candidate.territoryId)) return null;
    return { title: candidate.title, body: candidate.body, territoryId: candidate.territoryId };
  } catch {
    return null;
  }
}

export function writePostComposerDraft(storage: DraftStorage, key: string, draft: PostComposerDraft) {
  try {
    if (!draft.title && !draft.body && !draft.territoryId) {
      storage.removeItem(key);
      return;
    }
    const title = draft.title.slice(0, CONTENT_LIMITS.postTitle.max);
    const body = draft.body.slice(0, CONTENT_LIMITS.postBody.max);
    const territoryId = TERRITORY_ID_PATTERN.test(draft.territoryId) ? draft.territoryId : "";
    storage.setItem(key, JSON.stringify({ v: DRAFT_VERSION, title, body, territoryId }));
  } catch {
    // Storage can be unavailable in strict privacy mode. The composer must remain usable.
  }
}

export function removePostComposerDraft(storage: DraftStorage, key: string) {
  try { storage.removeItem(key); }
  catch { /* Storage access is best-effort. */ }
}
