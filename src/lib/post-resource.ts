const POST_RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function normalizePostResourceId(value: unknown) {
  if (typeof value !== "string") return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value).trim(); }
  catch { return null; }
  return POST_RESOURCE_ID_PATTERN.test(decoded) ? decoded : null;
}

export function postDetailPath(postId: string) {
  const normalized = normalizePostResourceId(postId);
  if (!normalized) throw new RangeError("Gönderi kimliği geçersiz.");
  return `/posts/${encodeURIComponent(normalized)}`;
}
