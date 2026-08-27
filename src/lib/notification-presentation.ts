import { normalizePostResourceId, postDetailPath } from "@/lib/post-resource";

export type NotificationCategory = "territory" | "social" | "system";

const TERRITORY_TYPES = new Set(["territory", "claim_confirmed", "territory_lost", "paint_confirmed"]);
const SOCIAL_TYPES = new Set(["social", "follow_request", "post_like", "post_comment"]);

export function notificationCategory(type: string): NotificationCategory {
  if (TERRITORY_TYPES.has(type)) return "territory";
  if (SOCIAL_TYPES.has(type)) return "social";
  return "system";
}

export function notificationHref(
  type: string,
  actorUsername?: string | null,
  resourceType?: string | null,
  resourceId?: string | null,
) {
  const postId = resourceType === "post" ? normalizePostResourceId(resourceId) : null;
  if (postId) return postDetailPath(postId);
  if (notificationCategory(type) === "territory") return "/play";
  if (actorUsername && notificationCategory(type) === "social") return `/users/${encodeURIComponent(actorUsername)}`;
  return null;
}
