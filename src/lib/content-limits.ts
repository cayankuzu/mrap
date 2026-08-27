/** İstemci ve sunucunun aynı kuralları kullanabilmesi için yalnızca saf sabitler içerir. */
export const CONTENT_LIMITS = {
  username: { min: 3, max: 20 },
  email: { max: 254 },
  password: { min: 8, max: 128 },
  displayName: { min: 2, max: 60 },
  bio: { max: 180 },
  postTitle: { min: 1, max: 80 },
  postBody: { max: 500 },
  commentBody: { min: 1, max: 300 },
} as const;

export const COMMENT_PAGE_LIMITS = {
  default: 20,
  max: 50,
} as const;

export const POST_PAGE_LIMITS = {
  default: 6,
  max: 12,
} as const;

export const CONNECTION_PAGE_LIMITS = {
  default: 20,
  max: 50,
} as const;

export const PLAYER_SEARCH_LIMITS = {
  queryMax: 40,
  results: 12,
} as const;

export const LEADERBOARD_LIMIT = 100;

export const MEDIA_LIMITS = {
  postImages: {
    maxCount: 6,
    maxDataUrlLength: 600_000,
    maxTotalDataUrlLength: 3_500_000,
  },
  postMapSnapshot: {
    maxDataUrlLength: 2_500_000,
  },
} as const;

export const DEFAULT_POST_TITLE = "Alan paylaşımı";
