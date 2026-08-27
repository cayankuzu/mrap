export type AppUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  initials: string;
  color: string;
  pattern: number;
  countryCode: string;
  cityId: string;
  country: string;
  city: string;
  bio: string;
  birthDate: string;
  accountVisibility: "public" | "private";
  locationVisibility: "private" | "approximate" | "friends";
  avatarData: string | null;
  coverData: string | null;
  createdAt: string;
};

export type PublicPlayer = Omit<AppUser, "email" | "birthDate" | "locationVisibility">;

/** Compact, list-safe user shape. avatarData is a protected media URL, never persisted base64. */
export type UserListPlayer = Pick<
  PublicPlayer,
  "id" | "username" | "displayName" | "initials" | "color" | "pattern" | "city" | "accountVisibility" | "avatarData"
>;

export type FeedPlayer = Pick<
  PublicPlayer,
  "id" | "username" | "displayName" | "initials" | "color" | "pattern" | "avatarData"
>;

export type CommentActor = Pick<
  FeedPlayer,
  "id" | "username" | "displayName" | "initials" | "color" | "avatarData"
>;

export type StoredTerritory = {
  id: string;
  userId: string;
  ownerUsername: string;
  name: string;
  district: string;
  geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  color: string;
  pattern: number;
  areaKm2: number;
  newlyAddedAreaKm2: number;
  overlapAreaKm2: number;
  totalAreaAfterKm2: number;
  distanceKm: number;
  durationSeconds: number;
  mapSnapshot: string | null;
  active: boolean;
  createdAt: string;
};

export type PostableTerritory = Omit<StoredTerritory, "mapSnapshot">;

export type CurrentTerritory = {
  userId: string;
  ownerUsername: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  areaM2: number;
  color: string;
  pattern: number;
  updatedAt: string;
};

export type TerritoryPaint = {
  id: string;
  userId: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  color: string;
  updatedAt: string;
};

export type TerritoryMapState = {
  territories: CurrentTerritory[];
  paints: TerritoryPaint[];
};

export type TerritoryClaimResult = {
  claim: StoredTerritory;
  currentTerritory: CurrentTerritory;
  newlyAddedAreaM2: number;
  overlapAreaM2: number;
  totalAreaAfterM2: number;
};

export type RouteSession = {
  id: string;
  userId: string;
  locationMode: "real" | "simulation";
  distanceM: number;
  durationSeconds: number;
  pointCount: number;
  startedAt: string;
  endedAt: string;
  createdAt: string;
};

export type RealPost = {
  id: string;
  userId: string;
  user: FeedPlayer;
  territory: PostableTerritory;
  title: string;
  body: string;
  images: string[];
  mapView: import("@/lib/map-preview").MapCameraState | null;
  likes: number;
  comments: number;
  likedByMe: boolean;
  savedByMe: boolean;
  followedByMe: boolean;
  requestedByMe: boolean;
  createdAt: string;
};

export type PostCursor = {
  createdAt: string;
  id: string;
};

export type PostPage = {
  posts: RealPost[];
  nextCursor: string | null;
  total: number;
};

export type PostComment = {
  id: string;
  postId: string;
  body: string;
  user: CommentActor;
  createdAt: string;
};

export type PostCommentCursor = {
  createdAt: string;
  id: string;
};

export type PostCommentPage = {
  comments: PostComment[];
  nextCursor: string | null;
  total: number;
};

export type AddPostCommentResult = {
  comment: PostComment;
  total: number;
  replayed: boolean;
};

export type SocialConnection = {
  user: UserListPlayer;
  relation: "none" | "following" | "requested";
};

export type ConnectionCursor = {
  searchKey: string;
  id: string;
};

export type ConnectionPage = {
  connections: SocialConnection[];
  nextCursor: string | null;
  total: number;
};

export type PlayerSearchResult = UserListPlayer & {
  followers: number;
  routes: number;
  areaKm2: number;
  relation: "none" | "following" | "requested";
};

export type LeaderboardEntry = {
  id: string;
  username: string;
  displayName: string;
  initials: string;
  color: string;
  pattern: number;
  city: string;
  avatarData: string | null;
  areaKm2: number;
  routes: number;
  rank: number;
};
