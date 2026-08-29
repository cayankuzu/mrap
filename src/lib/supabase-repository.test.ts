import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  decodeProfileImage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin-client", () => ({
  createMrapSupabaseAdminClient: mocks.createAdmin,
}));
vi.mock("@/server/http/media-validation", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/http/media-validation")>();
  return { ...original, decodeSanitizedImageDataUrl: mocks.decodeProfileImage };
});

import {
  getScopedLeaderboard,
  getRouteSessionTotals,
  listPostPage,
  resolveFollowRequest,
  setLikeState,
  updateUser,
} from "@/lib/supabase-repository";

type Operation = { name: string; args: unknown[] };
type QueryResult = { data?: unknown; error?: unknown; count?: number | null };
type QueryResolver = (table: string, operations: readonly Operation[]) => QueryResult | Promise<QueryResult>;

const chainMethods = [
  "select", "eq", "neq", "in", "is", "not", "ilike", "or", "order", "limit", "range",
  "insert", "update", "upsert", "delete", "single", "maybeSingle",
] as const;

function queryBuilder(table: string, resolver: QueryResolver, queryLog: Array<{ table: string; operations: Operation[] }>) {
  const operations: Operation[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of chainMethods) {
    builder[method] = (...args: unknown[]) => {
      operations.push({ name: method, args });
      return builder;
    };
  }
  builder.then = (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) => {
    queryLog.push({ table, operations: [...operations] });
    return Promise.resolve(resolver(table, operations)).then(onFulfilled, onRejected);
  };
  return builder;
}

function adminDouble(resolver: QueryResolver) {
  const queryLog: Array<{ table: string; operations: Operation[] }> = [];
  const upload = vi.fn().mockResolvedValue({ data: { path: "uploaded" }, error: null });
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const list = vi.fn().mockResolvedValue({ data: [], error: null });
  const download = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn((table: string) => queryBuilder(table, resolver, queryLog));
  const admin = {
    from,
    rpc: vi.fn(),
    auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: { email: "oyuncu@example.com" } }, error: null }) } },
    storage: { from: vi.fn(() => ({ upload, remove, list, download })) },
  };
  return { admin, queryLog, upload, remove };
}

function operation(operations: readonly Operation[], name: string) {
  return operations.find((entry) => entry.name === name);
}

const profile = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "oyuncu",
  display_name: "Örnek Oyuncu",
  country_code: "TR",
  city_id: "istanbul",
  bio: "",
  color: "#0D8BFF",
  pattern: 0,
  account_visibility: "public",
  avatar_object_key: null,
  cover_object_key: null,
  created_at: "2026-08-27T10:00:00.000Z",
};

const privateProfile = {
  user_id: profile.id,
  birth_date: "2000-01-01",
  location_visibility: "private",
};

function profileReadResult(table: string, operations: readonly Operation[]): QueryResult | null {
  if (operation(operations, "update")) return null;
  if (table === "profiles") return { data: profile, error: null };
  if (table === "profile_private") return { data: privateProfile, error: null };
  if (table === "countries") return { data: { name_tr: "Türkiye" }, error: null };
  if (table === "cities") return { data: { name_tr: "İstanbul" }, error: null };
  return null;
}

describe("Supabase repository production sözleşmeleri", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decodeProfileImage.mockImplementation((value: string, options: { maxDataUrlLength: number }) => (
      value.length > options.maxDataUrlLength
        ? null
        : { mimeType: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), dimensions: { width: 1, height: 1 }, canonical: value }
    ));
  });

  it("profil görseli sınırını doğrudan adapter çağrısında da uygular", async () => {
    const double = adminDouble((table, operations) => profileReadResult(table, operations) ?? { data: null, error: null });
    mocks.createAdmin.mockReturnValue(double.admin);
    const oversized = `data:image/jpeg;base64,${"A".repeat(650_000)}`;

    await expect(updateUser(profile.id, { avatarData: oversized })).rejects.toThrow("Profil görseli geçersiz");

    expect(mocks.decodeProfileImage).toHaveBeenCalledWith(oversized, expect.objectContaining({ maxDataUrlLength: 650_000 }));
    expect(double.upload).not.toHaveBeenCalled();
  });

  it("özel profil güncellemesi bozulursa public profili geri alıp yeni medyayı temizler", async () => {
    let profileUpdates = 0;
    const double = adminDouble((table, operations) => {
      const read = profileReadResult(table, operations);
      if (read) return read;
      if (table === "profiles" && operation(operations, "update")) {
        profileUpdates += 1;
        return { data: null, error: null };
      }
      if (table === "profile_private" && operation(operations, "update")) {
        return { data: null, error: { code: "P0001" } };
      }
      return { data: null, error: null };
    });
    mocks.createAdmin.mockReturnValue(double.admin);

    await expect(updateUser(profile.id, { avatarData: "data:image/jpeg;base64,AA==" }))
      .rejects.toThrow("Özel profil güncelleme tamamlanamadı");

    expect(profileUpdates).toBe(2);
    expect(double.upload).toHaveBeenCalledOnce();
    expect(double.remove).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^${profile.id}/profile/avatar/`))]);
  });

  it("rota toplamlarını Supabase 1000 satır sınırında kesmez", async () => {
    const double = adminDouble((table, operations) => {
      if (table !== "route_sessions") return { data: null, error: null };
      const from = Number(operation(operations, "range")?.args[0] ?? 0);
      const data = from === 0
        ? Array.from({ length: 1_000 }, () => ({ distance_m: "2", duration_seconds: 3 }))
        : [{ distance_m: "5", duration_seconds: 7 }];
      return { data, error: null };
    });
    mocks.createAdmin.mockReturnValue(double.admin);

    await expect(getRouteSessionTotals(profile.id)).resolves.toEqual({
      distanceM: 2_005,
      durationSeconds: 3_007,
      sessionCount: 1_001,
    });
    expect(double.queryLog.filter((entry) => entry.table === "route_sessions")).toHaveLength(2);
  });

  it("kapsamlı şehir sıralamasında canonical/legacy kimlikleri birleştirir ve eksik score'u sıfır kabul eder", async () => {
    const profiles = [
      { ...profile, id: "00000000-0000-4000-8000-000000000011", username: "legacy", city_id: "tr-istanbul", created_at: "2026-01-01T00:00:00.000Z" },
      { ...profile, id: "00000000-0000-4000-8000-000000000012", username: "canonical", city_id: "csc:TR:34:153786", created_at: "2026-01-02T00:00:00.000Z" },
      { ...profile, id: "00000000-0000-4000-8000-000000000013", username: "berlin", country_code: "DE", city_id: "de-berlin", created_at: "2026-01-03T00:00:00.000Z" },
    ];
    const double = adminDouble((table, operations) => {
      if (table === "profiles") {
        const select = String(operation(operations, "select")?.args[0] ?? "");
        const inFilter = operation(operations, "in")?.args;
        const filtered = inFilter
          ? profiles.filter((row) => (inFilter[1] as string[]).includes(String(row[inFilter[0] as "id" | "city_id" | "country_code"])))
          : profiles;
        return select === "id,created_at"
          ? { data: filtered.map(({ id, created_at }) => ({ id, created_at })), error: null }
          : { data: filtered, error: null };
      }
      if (table === "cities") return { data: [
        { id: "tr-istanbul", country_code: "TR", name_tr: "İstanbul" },
        { id: "csc:TR:34:153786", country_code: "TR", name_tr: "İstanbul" },
        { id: "de-berlin", country_code: "DE", name_tr: "Berlin" },
      ], error: null };
      if (table === "countries") return { data: [
        { code: "TR", name_tr: "Türkiye" },
        { code: "DE", name_tr: "Almanya" },
      ], error: null };
      if (table === "worlds") return { data: { id: "world-main", current_version: 1 }, error: null };
      if (table === "player_scores") return { data: [{
        user_id: profiles[1].id,
        current_territory_area_m2: 1_500_000,
        claim_count: 2,
      }], error: null };
      return { data: [], error: null };
    });
    mocks.createAdmin.mockReturnValue(double.admin);

    const result = await getScopedLeaderboard({
      scope: "city",
      cities: [{ countryCode: "tr", city: "ISTANBUL" }],
      limit: 10,
    });

    expect(result.map((entry) => [entry.username, entry.areaKm2, entry.rank])).toEqual([
      ["canonical", 1.5, 1],
      ["legacy", 0, 2],
    ]);
    expect(result.map((entry) => entry.cityId)).toEqual(["csc:TR:34:153786", "tr-istanbul"]);
    const hydration = double.queryLog.find((entry) => entry.table === "profiles"
      && String(operation(entry.operations, "select")?.args[0] ?? "").includes("username"));
    expect(new Set(operation(hydration!.operations, "in")?.args[1] as string[])).toEqual(new Set([
      profiles[0].id,
      profiles[1].id,
    ]));
  });

  it("dünya sıralamasında önce score limitini uygular ve yalnız kalan slot kadar sıfır profili hydrate eder", async () => {
    const profiles = [
      { ...profile, id: "00000000-0000-4000-8000-000000000021", username: "zero-old", created_at: "2026-01-01T00:00:00.000Z" },
      { ...profile, id: "00000000-0000-4000-8000-000000000022", username: "leader", created_at: "2026-01-02T00:00:00.000Z" },
      { ...profile, id: "00000000-0000-4000-8000-000000000023", username: "zero-new", created_at: "2026-01-03T00:00:00.000Z" },
    ];
    const double = adminDouble((table, operations) => {
      if (table === "profiles") {
        const select = String(operation(operations, "select")?.args[0] ?? "");
        const ids = operation(operations, "in")?.args[1] as string[] | undefined;
        const filtered = ids ? profiles.filter((row) => ids.includes(row.id)) : profiles;
        return select === "id,created_at"
          ? { data: filtered.map(({ id, created_at }) => ({ id, created_at })), error: null }
          : { data: filtered, error: null };
      }
      if (table === "cities") return { data: [{ id: "istanbul", name_tr: "İstanbul" }], error: null };
      if (table === "countries") return { data: [{ code: "TR", name_tr: "Türkiye" }], error: null };
      if (table === "worlds") return { data: { id: "world-main", current_version: 1 }, error: null };
      if (table === "player_scores") return { data: [{
        user_id: profiles[1].id,
        current_territory_area_m2: 2_000_000,
        claim_count: 1,
      }], error: null };
      return { data: [], error: null };
    });
    mocks.createAdmin.mockReturnValue(double.admin);

    const result = await getScopedLeaderboard({ scope: "world", limit: 2 });

    expect(result.map((entry) => [entry.username, entry.areaKm2])).toEqual([
      ["leader", 2],
      ["zero-old", 0],
    ]);
    const scoreQuery = double.queryLog.find((entry) => entry.table === "player_scores")!;
    expect(operation(scoreQuery.operations, "limit")?.args[0]).toBe(2);
    expect(operation(scoreQuery.operations, "in")).toBeUndefined();
    const hydration = double.queryLog.find((entry) => entry.table === "profiles"
      && String(operation(entry.operations, "select")?.args[0] ?? "").includes("username"))!;
    expect(new Set(operation(hydration.operations, "in")?.args[1] as string[])).toEqual(new Set([
      profiles[0].id,
      profiles[1].id,
    ]));
  });

  it("takip akışını tüm takip sayfalarından kurar ve cursor toplamını azaltmaz", async () => {
    const double = adminDouble((table, operations) => {
      if (table === "follows") {
        const from = Number(operation(operations, "range")?.args[0] ?? 0);
        return {
          data: from === 0
            ? Array.from({ length: 1_000 }, (_, index) => ({ followed_id: `followed-${index}` }))
            : [{ followed_id: "followed-1000" }],
          error: null,
        };
      }
      if (table === "posts") {
        const selectOptions = operation(operations, "select")?.args[1] as { head?: boolean } | undefined;
        const authorIds = operation(operations, "in")?.args[1] as string[] | undefined;
        return selectOptions?.head
          ? { data: null, error: null, count: authorIds?.includes(profile.id) ? 77 : 0 }
          : { data: [], error: null };
      }
      return { data: [], error: null };
    });
    mocks.createAdmin.mockReturnValue(double.admin);

    const page = await listPostPage(profile.id, "following", {
      cursor: { createdAt: "2026-08-27T10:00:00.000Z", id: "00000000-0000-4000-8000-000000000010" },
      limit: 6,
    });

    expect(page).toEqual({ posts: [], nextCursor: null, total: 77 });
    const postQueries = double.queryLog.filter((entry) => entry.table === "posts");
    const rowQueries = postQueries.filter((entry) => !(operation(entry.operations, "select")?.args[1] as { head?: boolean } | undefined)?.head);
    const authorChunks = rowQueries.map((entry) => operation(entry.operations, "in")?.args[1] as string[]);
    expect(authorChunks.every((chunk) => chunk.length <= 200)).toBe(true);
    expect(new Set(authorChunks.flat()).size).toBe(1_002);
    const countQueries = postQueries.filter((entry) => (operation(entry.operations, "select")?.args[1] as { head?: boolean } | undefined)?.head);
    expect(countQueries.every((entry) => !operation(entry.operations, "or"))).toBe(true);
  });

  it("kendi gönderi akışında gereksiz takip ve açık profil kapsamı okumaz", async () => {
    const double = adminDouble((table, operations) => {
      if (table === "posts") {
        const selectOptions = operation(operations, "select")?.args[1] as { head?: boolean } | undefined;
        return selectOptions?.head
          ? { data: null, error: null, count: 0 }
          : { data: [], error: null };
      }
      return { data: [], error: null };
    });
    mocks.createAdmin.mockReturnValue(double.admin);

    await expect(listPostPage(profile.id, "mine")).resolves.toEqual({ posts: [], nextCursor: null, total: 0 });
    expect(double.queryLog.some((entry) => entry.table === "follows")).toBe(false);
    expect(double.queryLog.some((entry) => entry.table === "profiles")).toBe(false);
  });

  it("gönderi durumlarını post başına tekrar etmek yerine sınırlı in sorgularıyla toplar", async () => {
    const postIds = [
      "00000000-0000-4000-8000-000000000101",
      "00000000-0000-4000-8000-000000000102",
    ];
    const claimIds = [
      "00000000-0000-4000-8000-000000000201",
      "00000000-0000-4000-8000-000000000202",
    ];
    const sessionIds = [
      "00000000-0000-4000-8000-000000000301",
      "00000000-0000-4000-8000-000000000302",
    ];
    const posts = postIds.map((id, index) => ({
      id,
      author_id: profile.id,
      claim_id: claimIds[index],
      claim_event_id: claimIds[index],
      title: `Alan ${index + 1}`,
      body: "",
      map_view: null,
      map_snapshot_object_key: null,
      idempotency_key: null,
      payload_hash: null,
      created_at: `2026-08-27T10:0${index}:00.000Z`,
    }));
    const claims = claimIds.map((id, index) => ({
      id,
      user_id: profile.id,
      route_session_id: sessionIds[index],
      raw_polygon: { type: "Polygon", coordinates: [[[29, 41], [29.001, 41], [29.001, 41.001], [29, 41]]] },
      newly_claimed_area_m2: 100,
      already_owned_area_m2: 0,
      total_loop_area_m2: 100,
      final_territory_area_m2: 100,
      selected_color_id: "#0D8BFF",
      committed_at_server: `2026-08-27T10:0${index}:00.000Z`,
    }));
    const sessions = sessionIds.map((id) => ({
      id,
      player_id: profile.id,
      location_mode: "real_gps",
      distance_m: 100,
      duration_seconds: 60,
      point_count: 4,
      started_at: "2026-08-27T09:59:00.000Z",
      ended_at: "2026-08-27T10:00:00.000Z",
      created_at: "2026-08-27T10:00:00.000Z",
    }));
    const double = adminDouble((table, operations) => {
      const selectOptions = operation(operations, "select")?.args[1] as { head?: boolean } | undefined;
      if (table === "posts") return selectOptions?.head
        ? { data: null, error: null, count: posts.length }
        : { data: posts, error: null };
      if (table === "profiles") return { data: [profile], error: null };
      if (table === "cities") return { data: [{ id: "istanbul", name_tr: "İstanbul" }], error: null };
      if (table === "countries") return { data: [{ code: "TR", name_tr: "Türkiye" }], error: null };
      if (table === "claim_events") return { data: claims, error: null };
      if (table === "route_sessions") return { data: sessions, error: null };
      if (table === "post_media") return { data: [], error: null };
      if (table === "likes") return selectOptions?.head
        ? { data: null, error: null, count: 3 }
        : { data: [{ post_id: postIds[0] }], error: null };
      if (table === "comments") return { data: null, error: null, count: 2 };
      if (table === "saved_posts") return { data: [{ post_id: postIds[1] }], error: null };
      return { data: [], error: null };
    });
    mocks.createAdmin.mockReturnValue(double.admin);

    const page = await listPostPage(profile.id, "mine");

    expect(page.posts).toHaveLength(2);
    expect(Object.fromEntries(page.posts.map((post) => [post.id, {
      likedByMe: post.likedByMe,
      savedByMe: post.savedByMe,
      likes: post.likes,
      comments: post.comments,
    }]))).toEqual({
      [postIds[0]]: { likedByMe: true, savedByMe: false, likes: 3, comments: 2 },
      [postIds[1]]: { likedByMe: false, savedByMe: true, likes: 3, comments: 2 },
    });
    const ownLikeQueries = double.queryLog.filter((entry) => entry.table === "likes"
      && !(operation(entry.operations, "select")?.args[1] as { head?: boolean } | undefined)?.head);
    const ownSaveQueries = double.queryLog.filter((entry) => entry.table === "saved_posts");
    expect(ownLikeQueries).toHaveLength(1);
    expect(ownSaveQueries).toHaveLength(1);
    expect(new Set(operation(ownLikeQueries[0].operations, "in")?.args[1] as string[])).toEqual(new Set(postIds));
    expect(new Set(operation(ownSaveQueries[0].operations, "in")?.args[1] as string[])).toEqual(new Set(postIds));
  });

  it("eşzamanlı duplicate beğenide ikinci bildirim üretmez", async () => {
    const double = adminDouble((table, operations) => {
      if (table === "posts") return { data: { author_id: profile.id }, error: null };
      if (table === "likes" && operation(operations, "upsert")) return { data: null, error: null };
      if (table === "likes" && (operation(operations, "select")?.args[1] as { head?: boolean } | undefined)?.head) {
        return { data: null, error: null, count: 1 };
      }
      return { data: null, error: null };
    });
    mocks.createAdmin.mockReturnValue(double.admin);

    await expect(setLikeState(profile.id, "00000000-0000-4000-8000-000000000020", true))
      .resolves.toEqual({ liked: true, count: 1 });
    expect(double.queryLog.some((entry) => entry.table === "notifications")).toBe(false);
  });

  it("önceden tüketilmiş takip isteğini ikinci kez kabul etmez", async () => {
    const double = adminDouble((table) => table === "follow_requests"
      ? { data: null, error: null }
      : { data: null, error: null });
    mocks.createAdmin.mockReturnValue(double.admin);

    await expect(resolveFollowRequest(profile.id, "00000000-0000-4000-8000-000000000030", "accept"))
      .resolves.toBe(false);
    expect(double.queryLog.some((entry) => entry.table === "follows")).toBe(false);
  });

  it("medya işlemlerinde migration ile yönetilen Supabase bucket yapılandırmasını kullanır", async () => {
    vi.stubEnv("SUPABASE_MEDIA_BUCKET", "mrap-media");
    try {
      vi.resetModules();
      const { updateUser: updateUserWithConfiguredBucket } = await import("@/lib/supabase-repository");
      const double = adminDouble((table, operations) => profileReadResult(table, operations) ?? { data: null, error: null });
      mocks.createAdmin.mockReturnValue(double.admin);

      await expect(updateUserWithConfiguredBucket(profile.id, { avatarData: "data:image/jpeg;base64,AA==" }))
        .resolves.toMatchObject({ id: profile.id });

      expect(double.admin.storage.from).toHaveBeenCalledWith("mrap-media");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
