import "server-only";

import { supabaseProviderEnabled } from "@/lib/supabase/server-config";

export { UserIdentityConflictError } from "@/lib/repository-contract";
export type { UserRow } from "@/lib/repository-contract";

type SqliteRepository = typeof import("@/lib/sqlite-repository");
type RepositoryFunctionName = {
  [Key in keyof SqliteRepository]: SqliteRepository[Key] extends (...args: never[]) => unknown ? Key : never
}[keyof SqliteRepository];
type RepositoryFunction<Key extends RepositoryFunctionName> = Extract<
  SqliteRepository[Key],
  (...args: never[]) => unknown
>;

type RepositoryModule = Record<PropertyKey, unknown>;
let loadedProvider: "sqlite" | "supabase" | null = null;
let repositoryPromise: Promise<RepositoryModule> | null = null;

function currentProvider() {
  return supabaseProviderEnabled() ? "supabase" as const : "sqlite" as const;
}

async function loadRepository() {
  const provider = currentProvider();
  if (!repositoryPromise || loadedProvider !== provider) {
    loadedProvider = provider;
    repositoryPromise = provider === "supabase"
      ? import("@/lib/supabase-repository")
      : import("@/lib/sqlite-repository");
  }
  return repositoryPromise;
}

function repositoryFunction<Key extends RepositoryFunctionName>(name: Key) {
  return async (
    ...args: Parameters<RepositoryFunction<Key>>
  ): Promise<Awaited<ReturnType<RepositoryFunction<Key>>>> => {
    const repository = await loadRepository();
    const implementation = repository[name];
    if (typeof implementation !== "function") {
      throw new Error(`Seçili veri sağlayıcısı ${String(name)} işlemini desteklemiyor.`);
    }
    return await Reflect.apply(implementation, repository, args) as Awaited<ReturnType<RepositoryFunction<Key>>>;
  };
}

export const toPublicUser = repositoryFunction("toPublicUser");
export const toPublicPlayer = repositoryFunction("toPublicPlayer");
export const findUserRowByEmail = repositoryFunction("findUserRowByEmail");
export const findUserRowByUsername = repositoryFunction("findUserRowByUsername");
export const findUserRowById = repositoryFunction("findUserRowById");
export const getUserAvatarData = repositoryFunction("getUserAvatarData");
export const getUserCoverData = repositoryFunction("getUserCoverData");
export const deleteUserAccount = repositoryFunction("deleteUserAccount");
export const createUser = repositoryFunction("createUser");
export const updateUser = repositoryFunction("updateUser");
export const updatePassword = repositoryFunction("updatePassword");
export const createPasswordResetToken = repositoryFunction("createPasswordResetToken");
export const resetPasswordWithToken = repositoryFunction("resetPasswordWithToken");
export const createSessionRecord = repositoryFunction("createSessionRecord");
export const deleteSessionRecord = repositoryFunction("deleteSessionRecord");
export const findUserBySession = repositoryFunction("findUserBySession");
export const claimTerritory = repositoryFunction("claimTerritory");
export const getCurrentTerritory = repositoryFunction("getCurrentTerritory");
export const listCurrentTerritories = repositoryFunction("listCurrentTerritories");
export const listTerritoryPaints = repositoryFunction("listTerritoryPaints");
export const getTerritoryMapState = repositoryFunction("getTerritoryMapState");
export const getWorldVersion = repositoryFunction("getWorldVersion");
export const getTerritory = repositoryFunction("getTerritory");
export const recordRouteSession = repositoryFunction("recordRouteSession");
export const listRouteSessions = repositoryFunction("listRouteSessions");
export const getRouteSessionTotals = repositoryFunction("getRouteSessionTotals");
export const listTerritories = repositoryFunction("listTerritories");
export const listPostableTerritories = repositoryFunction("listPostableTerritories");
export const listTerritoryArchive = repositoryFunction("listTerritoryArchive");
export const listPostPage = repositoryFunction("listPostPage");
export const listSavedPostPage = repositoryFunction("listSavedPostPage");
export const listUserPostPage = repositoryFunction("listUserPostPage");
export const listPosts = repositoryFunction("listPosts");
export const listUserPosts = repositoryFunction("listUserPosts");
export const listSavedPosts = repositoryFunction("listSavedPosts");
export const createPostRecord = repositoryFunction("createPostRecord");
export const getPostForViewer = repositoryFunction("getPostForViewer");
export const getPostImageForViewer = repositoryFunction("getPostImageForViewer");
export const canViewPost = repositoryFunction("canViewPost");
export const setLikeState = repositoryFunction("setLikeState");
export const listPostLikers = repositoryFunction("listPostLikers");
export const setSaveState = repositoryFunction("setSaveState");
export const listPostComments = repositoryFunction("listPostComments");
export const addComment = repositoryFunction("addComment");
export const getFollowRelation = repositoryFunction("getFollowRelation");
export const setFollowState = repositoryFunction("setFollowState");
export const listFollowRequests = repositoryFunction("listFollowRequests");
export const resolveFollowRequest = repositoryFunction("resolveFollowRequest");
export const searchPlayers = repositoryFunction("searchPlayers");
export const getPlayerProfile = repositoryFunction("getPlayerProfile");
export const getConnectionListAccess = repositoryFunction("getConnectionListAccess");
export const listConnectionPage = repositoryFunction("listConnectionPage");
export const getUserStats = repositoryFunction("getUserStats");
export const getLeaderboard = repositoryFunction("getLeaderboard");
export const getScopedLeaderboard = repositoryFunction("getScopedLeaderboard");
export const getLeaderboardRank = repositoryFunction("getLeaderboardRank");
export const listNotifications = repositoryFunction("listNotifications");
export const markNotificationsRead = repositoryFunction("markNotificationsRead");
