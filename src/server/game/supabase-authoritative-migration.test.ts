import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608270015_authoritative_game_runtime.sql",
), "utf8");
const contractCheck = readFileSync(resolve(
  process.cwd(),
  "scripts/check-supabase-contract.mjs",
), "utf8");
const claimSource = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608260010_claim_transaction_rls_realtime.sql",
), "utf8");
const baseRulesMigration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608260002_territory_postgis.sql",
), "utf8");
const multiplayerRulesMigration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608260009_authoritative_multiplayer_core.sql",
), "utf8");

function functionBody(name: string, nextName: string) {
  const start = migration.indexOf(`create or replace function ${name}`);
  const end = migration.indexOf(`create or replace function ${nextName}`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

function authoritativeRuleAssignments() {
  const update = migration.match(
    /update app_private\.game_rules\s+set ([\s\S]*?)\s+updated_at = statement_timestamp\(\)\s+where singleton = true;/,
  );
  expect(update).not.toBeNull();

  return Object.fromEntries(
    [...(update?.[1] ?? "").matchAll(/([a-z0-9_]+)\s*=\s*([0-9]+(?:\.[0-9]+)?)/g)]
      .map(([, column, value]) => [column, Number(value)]),
  );
}

describe("authoritative runtime migration hardening", () => {
  it("evolves the session lease constraint before installing authoritative defaults", () => {
    const oldConstraint = "check (session_lease_seconds between 30 and 900)";
    const dropConstraint = "drop constraint if exists game_rules_session_lease_seconds_check";
    const setDefault = "alter column session_lease_seconds set default 1800";
    const newConstraint = "check (session_lease_seconds between 60 and 21600)";
    const rulesUpdate = "update app_private.game_rules";

    expect(multiplayerRulesMigration).toContain(oldConstraint);
    expect(migration).toContain(dropConstraint);
    expect(migration).toContain(setDefault);
    expect(migration).toContain(newConstraint);
    expect(migration.indexOf(dropConstraint)).toBeLessThan(migration.indexOf(rulesUpdate));
    expect(migration.indexOf(setDefault)).toBeLessThan(migration.indexOf(rulesUpdate));
    expect(migration.indexOf(newConstraint)).toBeLessThan(migration.indexOf(rulesUpdate));
  });

  it("keeps all 22 authoritative defaults inside their installed database checks", () => {
    const rules = authoritativeRuleAssignments();
    const expected = {
      minimum_claim_area_m2: 35,
      maximum_claim_area_m2: 25_000_000,
      minimum_route_length_m: 25,
      maximum_polygon_points: 3_500,
      maximum_route_points: 10_000,
      maximum_gps_accuracy_m: 65,
      maximum_plausible_speed_mps: 12,
      real_gps_proximity_threshold_m: 12,
      simulator_proximity_threshold_m: 4,
      minimum_claim_cell_count: 1,
      maximum_claim_cell_count: 25_000,
      maximum_batch_points: 100,
      maximum_batch_bytes: 96_000,
      realtime_patch_cell_limit: 350,
      session_lease_seconds: 1_800,
      offline_grace_seconds: 20,
      raw_point_retention_days: 30,
      maximum_competitive_risk_score: 15,
      claim_rate_window_seconds: 600,
      claim_rate_max_commands: 40,
      paint_cooldown_seconds: 5,
      minimum_loop_point_count: 5,
    };
    const checks: Record<string, (value: number, values: Record<string, number>) => boolean> = {
      minimum_claim_area_m2: (value) => value > 0,
      maximum_claim_area_m2: (value, values) => value > values.minimum_claim_area_m2,
      minimum_route_length_m: (value) => value > 0,
      maximum_polygon_points: (value) => value >= 4 && value <= 10_000,
      maximum_route_points: (value) => value >= 2 && value <= 50_000,
      maximum_gps_accuracy_m: (value) => value > 0,
      maximum_plausible_speed_mps: (value) => value > 0,
      real_gps_proximity_threshold_m: (value) => value >= 1 && value <= 100,
      simulator_proximity_threshold_m: (value) => value >= 0.25 && value <= 25,
      minimum_claim_cell_count: (value) => value >= 1 && value <= 1_000,
      maximum_claim_cell_count: (value) => value >= 10 && value <= 50_000,
      maximum_batch_points: (value) => value >= 1 && value <= 512,
      maximum_batch_bytes: (value) => value >= 1_024 && value <= 262_144,
      realtime_patch_cell_limit: (value) => value >= 1 && value <= 2_000,
      session_lease_seconds: (value) => value >= 60 && value <= 21_600,
      offline_grace_seconds: (value) => value >= 0 && value <= 120,
      raw_point_retention_days: (value) => value >= 1 && value <= 90,
      maximum_competitive_risk_score: (value) => value >= 1 && value <= 100,
      claim_rate_window_seconds: (value) => value >= 10 && value <= 3_600,
      claim_rate_max_commands: (value) => value >= 1 && value <= 100,
      paint_cooldown_seconds: (value) => value >= 0 && value <= 300,
      minimum_loop_point_count: (value) => value >= 3 && value <= 101,
    };

    expect(rules).toEqual(expected);
    expect(Object.keys(checks).sort()).toEqual(Object.keys(expected).sort());
    for (const [column, check] of Object.entries(checks)) {
      expect(check(rules[column], rules), column).toBe(true);
    }

    for (const expression of [
      "check (minimum_claim_area_m2 > 0)",
      "check (maximum_claim_area_m2 > minimum_claim_area_m2)",
      "check (minimum_route_length_m > 0)",
      "check (maximum_polygon_points between 4 and 10000)",
      "check (maximum_route_points between 2 and 50000)",
      "check (maximum_gps_accuracy_m > 0)",
      "check (maximum_plausible_speed_mps > 0)",
    ]) {
      expect(baseRulesMigration).toContain(expression);
    }
    for (const expression of [
      "check (real_gps_proximity_threshold_m between 1 and 100)",
      "check (simulator_proximity_threshold_m between 0.25 and 25)",
      "check (minimum_claim_cell_count between 1 and 1000)",
      "check (maximum_claim_cell_count between 10 and 50000)",
      "check (maximum_batch_points between 1 and 512)",
      "check (maximum_batch_bytes between 1024 and 262144)",
      "check (realtime_patch_cell_limit between 1 and 2000)",
      "check (offline_grace_seconds between 0 and 120)",
      "check (raw_point_retention_days between 1 and 90)",
      "check (maximum_competitive_risk_score between 1 and 100)",
      "check (claim_rate_window_seconds between 10 and 3600)",
      "check (claim_rate_max_commands between 1 and 100)",
      "check (paint_cooldown_seconds between 0 and 300)",
    ]) {
      expect(multiplayerRulesMigration).toContain(expression);
    }
    expect(migration).toContain("check (session_lease_seconds between 60 and 21600)");
    expect(migration).toContain("check (minimum_loop_point_count between 3 and 101)");
  });

  it("uses the partial unique live-session index without a global world row lock", () => {
    const body = functionBody("public.mrap_game_start_session", "public.mrap_game_takeover_session");
    expect(body).not.toMatch(/from public\.worlds[^;]+for update/i);
    expect(body).toContain("route_sessions_one_live_competitive_idx");
    expect(body).toContain("'errorCode', 'SESSION_CONFLICT'");
    expect(body).toContain("with stale as materialized");
    expect(body).toContain("order by rs.id\n    for update");
  });

  it("locks revoke and continue flows session-first", () => {
    const revoke = functionBody("public.mrap_game_revoke_sessions", "public.mrap_game_append_point_batch");
    expect(revoke.indexOf("from public.route_sessions rs")).toBeLessThan(
      revoke.indexOf("from public.loop_candidates lc"),
    );

    const continued = functionBody("public.mrap_game_continue_candidate", "public.mrap_game_finish_session");
    expect(continued.indexOf("app_private.require_game_session")).toBeLessThan(
      continued.indexOf("select lc.* into v_candidate"),
    );
  });

  it("validates candidate cells set-wise and defers owner-null rows to claim", () => {
    const candidate = functionBody("public.mrap_game_create_candidate", "public.mrap_game_continue_candidate");
    expect(candidate).not.toMatch(/\bforeach\b/i);
    expect(candidate).toContain("from unnest(p_target_cell_ids)");
    expect(candidate).toContain("on conflict (world_id, region_key) do nothing");
    expect(candidate).not.toContain("insert into public.territory_cells");
    expect(candidate).toContain("'routeProofCount', v_route_proof_count");
    expect(candidate).toContain("'detectedRegionVersions', v_region_versions");
  });

  it("upgrades claim proof, lock order, score serialization and world versioning", () => {
    expect(migration).toContain("CLAIM_UPGRADE_SESSION_PREFLIGHT_SHAPE_MISMATCH");
    expect(migration).toContain("CLAIM_UPGRADE_POINT_COVERAGE_SHAPE_MISMATCH");
    expect(migration).toContain("CLAIM_UPGRADE_POINT_THRESHOLD_SHAPE_MISMATCH");
    expect(migration).toContain("CLAIM_UPGRADE_CANDIDATE_WATERMARK_SHAPE_MISMATCH");
    expect(migration).toContain("CLAIM_UPGRADE_SCORE_LOCK_SHAPE_MISMATCH");
    expect(migration).toContain("v_world_version := nextval('public.world_version_seq')");
    expect(migration).toContain("point_value ->> 'classification') in ('ACCEPTED', 'SUSPICIOUS')");
    expect(migration).toContain("v_candidate.validation_result ->> 'routeProofCount'");
    expect(migration).toContain("OWNERSHIP_BOUNDARY_CHANGED");
  });

  it("shape-checks every dynamic claim upgrade against the installed phase-10 source", () => {
    const oldShapes = [...migration.matchAll(/\$(old_[a-z_]+)\$([\s\S]*?)\$\1\$/g)];
    expect(oldShapes).toHaveLength(15);
    for (const [, tag, shape] of oldShapes) {
      expect(shape.length, tag).toBeGreaterThan(0);
      expect(claimSource.split(shape).length - 1, tag).toBe(1);
    }
  });

  it("keeps application and database claim limits aligned", () => {
    expect(migration).toMatch(/real_gps_proximity_threshold_m\s*=\s*12/);
    expect(migration).toMatch(/simulator_proximity_threshold_m\s*=\s*4/);
    expect(migration).toMatch(/maximum_competitive_risk_score\s*=\s*15/);
    expect(migration).toMatch(/maximum_polygon_points\s*=\s*3500/);
    expect(migration).toMatch(/realtime_patch_cell_limit\s*=\s*350/);
    expect(migration).toMatch(/minimum_loop_point_count\s*=\s*5/);

    const candidate = functionBody("public.mrap_game_create_candidate", "public.mrap_game_continue_candidate");
    expect(candidate).toContain("p_source_segment_index <> v_session.current_segment_index");
    expect(candidate).toContain("when 'real_gps' then v_rules.real_gps_proximity_threshold_m");
    expect(candidate).toContain("when 'development_simulation' then v_rules.simulator_proximity_threshold_m");
    expect(candidate).toContain("PROXIMITY_RULE_MISMATCH");
    expect(candidate).toContain("v_proximity_threshold_m, 'available'");
    expect(migration).toContain("p_last_accepted_point_sequence < v_candidate.end_sequence");
    expect(migration).toContain("p_last_accepted_point_sequence > v_session.last_accepted_sequence");
    expect(migration).toContain("v_candidate.source_segment_index <> v_session.current_segment_index");
  });

  it("publishes only dissolved valid region-scoped map geometry to rendering", () => {
    const mapState = functionBody("public.mrap_game_region_map_state", "public.mrap_game_publish_outbox");
    expect(mapState).toContain("tc.region_id = any(p_region_ids)");
    expect(mapState).toContain("extensions.st_unaryunion");
    expect(mapState).toContain("extensions.st_makevalid");
    expect(mapState).toContain("extensions.st_collectionextract");
    expect(mapState).toContain("'territories', tp.territories");
    expect(mapState).toContain("'paints', pp.paints");
    expect(migration).toContain(
      "grant execute on function public.mrap_game_region_map_state(uuid, uuid[]) to service_role",
    );
  });

  it("compacts every terminal candidate while preserving command and event history", () => {
    const compact = functionBody("app_private.compact_loop_candidate", "app_private.game_session_json");
    expect(compact).toContain("target_cell_ids = array['redacted']::text[]");
    expect(compact).toContain("- 'sourceStartPoint'");
    expect(compact).toContain("- 'sourceEndPoint'");
    expect(compact).toContain("'payloadCompacted', true");
    expect(migration).toContain("CLAIM_UPGRADE_NOOP_COMPACTION_SHAPE_MISMATCH");
    expect(migration).toContain("CLAIM_UPGRADE_COMMITTED_COMPACTION_SHAPE_MISMATCH");
    expect(migration).toContain("CLAIM_UPGRADE_REJECTED_COMPACTION_SHAPE_MISMATCH");
  });

  it("checks every critical database rule against runtime environment defaults", () => {
    for (const key of [
      "minimumClaimAreaM2", "maximumClaimAreaM2", "minimumRouteLengthM",
      "maximumCompetitiveRiskScore", "maximumPolygonPoints", "maximumRoutePoints",
      "maximumGpsAccuracyM", "maximumPlausibleSpeedMps", "realGpsProximityThresholdM",
      "simulatorProximityThresholdM", "minimumClaimCells", "maximumClaimCells",
      "maximumBatchPoints", "maximumBatchBytes", "maximumInlinePatchCells",
      "sessionLeaseSeconds", "offlineGraceSeconds", "rawPointRetentionDays",
      "claimRateWindowSeconds", "claimRateMaxCommands", "paintCooldownSeconds",
      "minimumLoopPointCount",
    ]) {
      expect(migration).toContain(`'${key}'`);
      expect(contractCheck).toContain(`${key}:`);
    }
    expect(contractCheck).toContain("Object.entries(expectedRules).every");
    expect(contractCheck).toContain("contract?.regionMapStateReady === true");
  });

  it("revokes raw GPS reads and exposes only service-role runtime bridges", () => {
    expect(migration).toContain("revoke select on table public.route_point_batches from authenticated");
    expect(migration).toContain(
      "revoke all on function public.mrap_game_owned_territory(uuid, uuid) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.mrap_game_owned_territory(uuid, uuid) to service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.mrap_game_publish_outbox(integer) to service_role",
    );
  });

  it("bounds retention without cascading claim history", () => {
    const retention = functionBody("public.purge_expired_location_data", "app_private.runtime_contract");
    expect(retention).toContain("for update skip locked");
    expect(retention).toContain("not exists (\n        select 1 from public.claim_commands");
    expect(retention).toContain("not exists (\n        select 1 from public.claim_events");
    expect(retention).toContain("deletedUnownedCells");
    expect(retention).toContain("deletedOutbox");
    expect(retention).toContain("publishedOutbox");
    expect(retention).toContain("compactedCandidates");
    expect(retention).toContain("'payloadCompacted'");
  });
});
