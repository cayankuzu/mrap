-- mrap production schema, phase 15: hosted authoritative game runtime.
--
-- Every function in this migration is a narrow bridge for the trusted Next.js
-- backend. Browser roles cannot create sessions, upload GPS evidence, create a
-- loop candidate or mutate ownership. The server stores only a SHA-256 digest
-- of the bearer session nonce and all state transitions are row-lock protected.

begin;

alter table public.worlds
  add column if not exists region_resolution smallint not null default 14
    check (region_resolution between 1 and grid_resolution);

alter table public.route_sessions
  add column if not exists server_nonce_hash text,
  add column if not exists last_received_sequence bigint not null default 0,
  add column if not exists current_segment_index integer not null default 0,
  add column if not exists suspicious_point_count integer not null default 0;

update public.route_sessions
set last_received_sequence = greatest(last_received_sequence, last_accepted_sequence)
where last_received_sequence < last_accepted_sequence;

-- Existing live sessions predate the digest-only contract and cannot be
-- recovered safely. Expire them once during rollout instead of retaining a
-- plaintext bearer secret.
update public.route_sessions
set status = 'expired',
    ended_at = coalesce(ended_at, statement_timestamp()),
    revoked_reason = coalesce(revoked_reason, 'nonce_digest_rollout'),
    updated_at = statement_timestamp()
where status in ('active', 'paused', 'closing')
  and server_nonce_hash is null;

update public.route_sessions
set server_nonce_hash = repeat('0', 64),
    server_nonce = repeat('0', 64)
where server_nonce_hash is null;

alter table public.route_sessions
  alter column server_nonce_hash set not null,
  add constraint route_sessions_nonce_hash_check
    check (server_nonce_hash ~ '^[0-9a-f]{64}$'),
  add constraint route_sessions_last_received_sequence_check
    check (last_received_sequence >= last_accepted_sequence),
  add constraint route_sessions_segment_index_check
    check (current_segment_index >= 0),
  add constraint route_sessions_suspicious_count_check
    check (suspicious_point_count between 0 and 50000);

alter table public.route_point_batches
  add column if not exists idempotency_key text,
  add column if not exists suspicious_count integer not null default 0,
  add column if not exists response_payload jsonb;

update public.route_point_batches
set idempotency_key = 'legacy_' || replace(id::text, '-', ''),
    response_payload = jsonb_build_object(
      'acceptedCount', accepted_count,
      'ignoredCount', ignored_count,
      'suspiciousCount', suspicious_count,
      'lastReceivedSequence', last_sequence,
      'lastAcceptedSequence', last_sequence,
      'classifications', '[]'::jsonb
    )
where idempotency_key is null or response_payload is null;

alter table public.route_point_batches
  alter column idempotency_key set not null,
  alter column response_payload set not null,
  add constraint route_point_batches_idempotency_key_check
    check (idempotency_key ~ '^[A-Za-z0-9_-]{16,100}$'),
  add constraint route_point_batches_suspicious_count_check
    check (suspicious_count between 0 and 512),
  add constraint route_point_batches_response_payload_check
    check (jsonb_typeof(response_payload) = 'object'),
  add constraint route_point_batches_session_idempotency_unique
    unique (route_session_id, idempotency_key);

alter table app_private.game_rules
  add column if not exists minimum_loop_point_count integer not null default 5
    check (minimum_loop_point_count between 3 and 101);

create table if not exists app_private.game_runtime_metrics (
  metric_key text primary key check (metric_key ~ '^[a-z0-9_]{3,80}$'),
  metric_value bigint not null default 0 check (metric_value >= 0),
  updated_at timestamptz not null default now()
);

revoke all on table app_private.game_runtime_metrics from public, anon, authenticated;
grant all on table app_private.game_runtime_metrics to service_role;

alter table public.realtime_outbox
  add column if not exists sequence bigint generated always as identity;
create unique index if not exists realtime_outbox_sequence_unique_idx
  on public.realtime_outbox(sequence);
create index if not exists realtime_outbox_world_region_sequence_idx
  on public.realtime_outbox(world_id, region_id, sequence);

-- The original multiplayer migration capped session leases at 15 minutes. The
-- authoritative runtime deliberately supports longer mobile background gaps,
-- so evolve the named constraint before installing the 30-minute default and
-- singleton rule value below. Existing values in the old range remain valid.
alter table app_private.game_rules
  drop constraint if exists game_rules_session_lease_seconds_check;

alter table app_private.game_rules
  alter column session_lease_seconds set default 1800;

alter table app_private.game_rules
  add constraint game_rules_session_lease_seconds_check
  check (session_lease_seconds between 60 and 21600);

update app_private.game_rules
set minimum_claim_area_m2 = 35,
    maximum_claim_area_m2 = 25000000,
    minimum_route_length_m = 25,
    maximum_polygon_points = 3500,
    maximum_route_points = 10000,
    maximum_gps_accuracy_m = 65,
    maximum_plausible_speed_mps = 12,
    real_gps_proximity_threshold_m = 12,
    simulator_proximity_threshold_m = 4,
    minimum_claim_cell_count = 1,
    maximum_claim_cell_count = 25000,
    maximum_batch_points = 100,
    maximum_batch_bytes = 96000,
    realtime_patch_cell_limit = 350,
    session_lease_seconds = 1800,
    offline_grace_seconds = 20,
    raw_point_retention_days = 30,
    maximum_competitive_risk_score = 15,
    claim_rate_window_seconds = 600,
    claim_rate_max_commands = 40,
    paint_cooldown_seconds = 5,
    minimum_loop_point_count = 5,
    updated_at = statement_timestamp()
where singleton = true;

-- Terminal candidates are routing evidence, not permanent geometry storage.
-- The immutable hash/sequences remain for audit correlation; committed claim
-- geometry lives in claim_events and idempotent responses in claim_commands.
-- A small valid sentinel keeps the phase-9 NOT NULL/check contract intact.
create or replace function app_private.compact_loop_candidate(
  p_candidate_id uuid,
  p_terminal_status text,
  p_claimed_event_id uuid default null
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_terminal_status not in ('claimed', 'continued', 'expired', 'invalid') then
    raise exception using errcode = '22023', message = 'INVALID_TERMINAL_CANDIDATE_STATUS';
  end if;

  update public.loop_candidates lc
  set status = p_terminal_status,
      claimed_event_id = coalesce(p_claimed_event_id, lc.claimed_event_id),
      raw_polygon = extensions.st_geomfromtext(
        'POLYGON((0 0,0 0.000001,0.000001 0,0 0))',
        4326
      ),
      target_cell_ids = array['redacted']::text[],
      affected_region_ids = array['00000000-0000-0000-0000-000000000000'::uuid],
      validation_result = (
        lc.validation_result
          - 'sourceStartPoint'
          - 'sourceEndPoint'
          - 'detectedRegionVersions'
          - 'sourceRegionVersions'
      ) || jsonb_build_object(
        'payloadCompacted', true,
        'compactedAt', statement_timestamp()
      )
  where lc.id = p_candidate_id;
end;
$$;

-- A table-level SELECT grant would reveal the bearer material to direct Data
-- API callers. All session reads now pass through the trusted BFF.
revoke select on table public.route_sessions from authenticated;
revoke select on table public.route_point_batches from authenticated;

create or replace function app_private.game_session_json(
  p_session public.route_sessions
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_session.id,
    'worldId', w.slug::text,
    'mode', p_session.location_mode,
    'status', p_session.status,
    'lastReceivedSequence', p_session.last_received_sequence,
    'lastAcceptedSequence', p_session.last_accepted_sequence,
    'currentSegmentIndex', p_session.current_segment_index,
    'riskScore', p_session.risk_score,
    'leaseExpiresAt', p_session.lease_expires_at,
    'startedAtServer', p_session.started_at
  )
  from public.worlds w
  where w.id = p_session.world_id
$$;

create or replace function app_private.require_game_session(
  p_user_id uuid,
  p_session_id uuid,
  p_nonce_hash text,
  p_require_live boolean default true
)
returns public.route_sessions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.route_sessions%rowtype;
begin
  if p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'NONCE_MISMATCH';
  end if;

  select rs.* into v_session
  from public.route_sessions rs
  where rs.id = p_session_id and rs.player_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SESSION_NOT_FOUND';
  end if;
  if v_session.server_nonce_hash <> p_nonce_hash then
    raise exception using errcode = '42501', message = 'NONCE_MISMATCH';
  end if;
  if not p_require_live then
    return v_session;
  end if;
  if v_session.status = 'revoked' then
    raise exception using errcode = '55000', message = 'SESSION_REVOKED';
  end if;
  if v_session.status not in ('active', 'paused', 'closing') then
    raise exception using errcode = '55000', message = 'INVALID_SESSION';
  end if;
  if v_session.lease_expires_at <= statement_timestamp() then
    -- Expiry is derived from the authoritative lease. A raised exception would
    -- roll back a status mutation in this helper, so bounded maintenance owns
    -- the persisted terminal transition instead.
    raise exception using errcode = '55000', message = 'SESSION_EXPIRED';
  end if;
  return v_session;
end;
$$;

create or replace function public.mrap_game_start_session(
  p_user_id uuid,
  p_world_slug text,
  p_mode text,
  p_nonce_hash text,
  p_lease_seconds integer,
  p_correlation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_world public.worlds%rowtype;
  v_session public.route_sessions%rowtype;
  v_id uuid := gen_random_uuid();
  v_constraint_name text;
begin
  if p_mode not in ('real_gps', 'development_simulation')
     or p_nonce_hash !~ '^[0-9a-f]{64}$'
     or p_lease_seconds not between 60 and 21600 then
    raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
  end if;

  -- Do not serialize every session start on the shared world row. The partial
  -- unique live-session index is the authoritative race arbiter below.
  select w.* into v_world
  from public.worlds w where w.slug = p_world_slug;
  if not found or v_world.status <> 'active' or not v_world.competitive_claims_enabled then
    raise exception using errcode = '55000', message = 'WORLD_NOT_ACTIVE';
  end if;
  if p_mode = 'development_simulation'
     and (v_world.environment <> 'sandbox' or not v_world.allow_simulated_location) then
    raise exception using errcode = '42501', message = 'PRODUCTION_SIMULATION_FORBIDDEN';
  end if;
  if p_mode = 'real_gps' and v_world.environment <> 'production' then
    raise exception using errcode = '22023', message = 'WORLD_MODE_MISMATCH';
  end if;

  -- Lock stale rows in the same deterministic order used by revoke and
  -- maintenance. A plain bulk UPDATE can choose a different heap order in two
  -- concurrent starts and deadlock before the partial unique index arbitrates.
  with stale as materialized (
    select rs.id
    from public.route_sessions rs
    where rs.player_id = p_user_id and rs.world_id = v_world.id
      and rs.status in ('active', 'paused', 'closing')
      and rs.lease_expires_at <= statement_timestamp()
    order by rs.id
    for update
  )
  update public.route_sessions rs
  set status = 'expired',
      ended_at = coalesce(rs.ended_at, rs.lease_expires_at),
      updated_at = statement_timestamp()
  from stale
  where rs.id = stale.id;

  perform app_private.compact_loop_candidate(candidate.id, 'expired')
  from (
    select lc.id
    from public.loop_candidates lc
    join public.route_sessions rs on rs.id = lc.route_session_id
    where rs.player_id = p_user_id
      and rs.world_id = v_world.id
      and rs.status = 'expired'
      and rs.lease_expires_at <= statement_timestamp()
      and lc.status = 'available'
    order by lc.id
    for update of lc
  ) candidate;

  if exists (
    select 1 from public.route_sessions rs
    where rs.player_id = p_user_id and rs.world_id = v_world.id
      and rs.session_kind = 'competitive' and rs.status in ('active', 'paused', 'closing')
  ) then
    return jsonb_build_object('status', 'rejected', 'errorCode', 'SESSION_CONFLICT');
  end if;

  begin
    insert into public.route_sessions(
      id, player_id, idempotency_key, payload_hash, location_mode,
      distance_m, duration_seconds, point_count, started_at, ended_at,
      world_id, session_kind, status, server_nonce, server_nonce_hash,
      last_received_sequence, last_accepted_sequence, current_segment_index,
      suspicious_point_count, lease_expires_at, last_checkpoint_at, risk_score
    ) values (
      v_id, p_user_id, 'competitive_' || replace(v_id::text, '-', ''), p_nonce_hash, p_mode,
      0, 0, 0, statement_timestamp(), null,
      v_world.id, 'competitive', 'active', p_nonce_hash, p_nonce_hash,
      0, 0, 0, 0, statement_timestamp() + make_interval(secs => p_lease_seconds),
      statement_timestamp(), 0
    ) returning * into v_session;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name is distinct from 'route_sessions_one_live_competitive_idx' then
        raise;
      end if;
      -- A concurrent request won the partial unique live-session index. Return
      -- normally so any stale-session expiry performed above is not rolled back.
      return jsonb_build_object('status', 'rejected', 'errorCode', 'SESSION_CONFLICT');
  end;

  insert into public.audit_events(
    actor_user_id, actor_type, action, target_type, target_id,
    world_id, correlation_id, metadata
  ) values (
    p_user_id, 'user', 'route_session.started', 'route_session', v_session.id::text,
    v_world.id, p_correlation_id, jsonb_build_object('mode', p_mode)
  );

  return app_private.game_session_json(v_session);
end;
$$;

create or replace function public.mrap_game_takeover_session(
  p_user_id uuid,
  p_world_slug text,
  p_mode text,
  p_nonce_hash text,
  p_lease_seconds integer,
  p_correlation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_world public.worlds%rowtype;
  v_session public.route_sessions%rowtype;
begin
  if p_mode not in ('real_gps', 'development_simulation')
     or p_nonce_hash !~ '^[0-9a-f]{64}$'
     or p_lease_seconds not between 60 and 21600 then
    raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
  end if;
  select w.* into v_world from public.worlds w where w.slug = p_world_slug;
  if not found then raise exception using errcode = 'P0002', message = 'WORLD_NOT_FOUND'; end if;
  if v_world.status <> 'active' or not v_world.competitive_claims_enabled then
    raise exception using errcode = '55000', message = 'WORLD_NOT_ACTIVE';
  end if;
  if p_mode = 'development_simulation' and not v_world.allow_simulated_location then
    raise exception using errcode = '42501', message = 'PRODUCTION_SIMULATION_FORBIDDEN';
  end if;
  if p_mode = 'real_gps' and v_world.environment <> 'production' then
    raise exception using errcode = '22023', message = 'WORLD_MODE_MISMATCH';
  end if;

  select rs.* into v_session
  from public.route_sessions rs
  where rs.player_id = p_user_id and rs.world_id = v_world.id
    and rs.location_mode = p_mode and rs.status in ('active', 'paused', 'closing')
    and rs.lease_expires_at > statement_timestamp()
  order by rs.started_at desc limit 1 for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SESSION_NOT_FOUND';
  end if;

  perform app_private.compact_loop_candidate(lc.id, 'expired')
  from (
    select candidate.id
    from public.loop_candidates candidate
    where candidate.route_session_id = v_session.id and candidate.status = 'available'
    order by candidate.id
    for update
  ) lc;
  update public.route_sessions
  set status = 'active', server_nonce = p_nonce_hash, server_nonce_hash = p_nonce_hash,
      current_segment_index = current_segment_index + 1,
      lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
      last_checkpoint_at = statement_timestamp()
  where id = v_session.id returning * into v_session;

  insert into public.audit_events(
    actor_user_id, actor_type, action, target_type, target_id,
    world_id, correlation_id, metadata
  ) values (
    p_user_id, 'user', 'route_session.taken_over', 'route_session', v_session.id::text,
    v_world.id, p_correlation_id, jsonb_build_object('mode', p_mode)
  );
  return app_private.game_session_json(v_session);
end;
$$;

create or replace function public.mrap_game_begin_segment(
  p_user_id uuid,
  p_session_id uuid,
  p_nonce_hash text,
  p_expected_segment_index integer,
  p_lease_seconds integer,
  p_correlation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.route_sessions%rowtype;
begin
  if p_expected_segment_index < 0 or p_lease_seconds not between 60 and 21600 then
    raise exception using errcode = '22023', message = 'INVALID_SEGMENT_INPUT';
  end if;
  v_session := app_private.require_game_session(p_user_id, p_session_id, p_nonce_hash, true);
  if v_session.current_segment_index = p_expected_segment_index then
    perform app_private.compact_loop_candidate(lc.id, 'expired')
    from (
      select candidate.id
      from public.loop_candidates candidate
      where candidate.route_session_id = p_session_id and candidate.status = 'available'
      order by candidate.id
      for update
    ) lc;
    update public.route_sessions
    set current_segment_index = current_segment_index + 1,
        lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
        last_checkpoint_at = statement_timestamp()
    where id = p_session_id returning * into v_session;
    insert into public.audit_events(
      actor_user_id, actor_type, action, target_type, target_id,
      world_id, correlation_id, metadata
    ) values (
      p_user_id, 'user', 'route_session.segment_started', 'route_session', p_session_id::text,
      v_session.world_id, p_correlation_id,
      jsonb_build_object('previousSegmentIndex', p_expected_segment_index)
    );
  elsif v_session.current_segment_index <> p_expected_segment_index + 1 then
    raise exception using errcode = '40001', message = 'SEGMENT_CONFLICT';
  end if;
  return app_private.game_session_json(v_session);
end;
$$;

create or replace function public.mrap_game_revoke_sessions(
  p_user_id uuid,
  p_correlation_id uuid default gen_random_uuid()
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  -- Lock the complete live-session set first and in one deterministic order.
  -- Candidate and raw-batch mutations must never precede their parent session
  -- lock because claim/append use the same session-first order.
  perform 1
  from public.route_sessions rs
  where rs.player_id = p_user_id
    and rs.status in ('active', 'paused', 'closing')
  order by rs.id
  for update;

  perform app_private.compact_loop_candidate(candidate.id, 'expired')
  from (
    select lc.id
    from public.loop_candidates lc
    where lc.player_id = p_user_id and lc.status = 'available'
      and exists (
        select 1 from public.route_sessions rs
        where rs.id = lc.route_session_id
          and rs.status in ('active', 'paused', 'closing')
      )
    order by lc.id
    for update
  ) candidate;
  delete from public.route_point_batches b
  where b.player_id = p_user_id and exists (
    select 1 from public.route_sessions rs
    where rs.id = b.route_session_id and rs.status in ('active', 'paused', 'closing')
  );
  update public.route_sessions
  set status = 'revoked', ended_at = coalesce(ended_at, statement_timestamp()),
      revoked_reason = 'logout', updated_at = statement_timestamp()
  where player_id = p_user_id and status in ('active', 'paused', 'closing');
  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into public.audit_events(
      actor_user_id, actor_type, action, target_type, correlation_id, metadata
    ) values (
      p_user_id, 'user', 'route_session.logout_revoked', 'route_session',
      p_correlation_id, jsonb_build_object('revokedSessionCount', v_count)
    );
  end if;
  return v_count;
end;
$$;

create or replace function public.mrap_game_append_point_batch(
  p_user_id uuid,
  p_session_id uuid,
  p_nonce_hash text,
  p_idempotency_key text,
  p_payload_hash text,
  p_points jsonb,
  p_accepted_count integer,
  p_ignored_count integer,
  p_suspicious_count integer,
  p_last_accepted_sequence bigint,
  p_distance_increment_m double precision,
  p_risk_delta numeric,
  p_segment_index integer,
  p_response_payload jsonb,
  p_lease_seconds integer,
  p_retention_days integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.route_sessions%rowtype;
  v_existing public.route_point_batches%rowtype;
  v_point_count integer;
  v_first_sequence bigint;
  v_last_sequence bigint;
begin
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{16,100}$'
     or p_payload_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_points) <> 'array'
     or jsonb_typeof(p_response_payload) <> 'object'
     or p_lease_seconds not between 60 and 21600
     or p_retention_days not between 1 and 365
     or p_distance_increment_m < 0
     or p_risk_delta < 0
     or p_segment_index < 0 then
    raise exception using errcode = '22023', message = 'INVALID_POINT_BATCH';
  end if;
  v_point_count := jsonb_array_length(p_points);
  if v_point_count < 1 or v_point_count > 512
     or p_accepted_count < 0 or p_ignored_count < 0 or p_suspicious_count < 0
     or p_accepted_count + p_ignored_count <> v_point_count
     or p_suspicious_count > p_accepted_count then
    raise exception using errcode = '22023', message = 'INVALID_POINT_BATCH_COUNTS';
  end if;
  begin
    v_first_sequence := (p_points -> 0 ->> 'sequence')::bigint;
    v_last_sequence := (p_points -> (v_point_count - 1) ->> 'sequence')::bigint;
  exception when others then
    raise exception using errcode = '22023', message = 'INVALID_POINT_SEQUENCE';
  end;
  if v_first_sequence < 1 or v_last_sequence - v_first_sequence + 1 <> v_point_count then
    raise exception using errcode = '22023', message = 'INVALID_POINT_SEQUENCE';
  end if;

  v_session := app_private.require_game_session(p_user_id, p_session_id, p_nonce_hash, true);

  select b.* into v_existing
  from public.route_point_batches b
  where b.route_session_id = p_session_id
    and b.player_id = p_user_id
    and b.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.payload_hash <> p_payload_hash then
      update public.route_sessions
      set risk_score = least(100, risk_score + 25)
      where id = p_session_id and player_id = p_user_id;
      insert into public.risk_events(
        world_id, user_id, route_session_id, risk_code, severity,
        score_delta, evidence
      ) values (
        v_session.world_id, p_user_id, p_session_id,
        'IDEMPOTENCY_PAYLOAD_MISMATCH', 'HIGH', 25,
        jsonb_build_object('operationType', 'append_point_batch')
      );
      -- Return a structured error so the security mutation commits. Raising
      -- here would roll back both the score and the evidence row.
      return jsonb_build_object(
        'status', 'rejected',
        'errorCode', 'IDEMPOTENCY_CONFLICT'
      );
    end if;
    return v_existing.response_payload;
  end if;

  if v_first_sequence <> v_session.last_received_sequence + 1 then
    raise exception using errcode = '22000', message = 'SEQUENCE_GAP';
  end if;
  if v_last_sequence > 50000
     or p_last_accepted_sequence < v_session.last_accepted_sequence
     or p_last_accepted_sequence > v_last_sequence
     or v_session.distance_m + p_distance_increment_m > 250000 then
    raise exception using errcode = '22023', message = 'POINT_BATCH_LIMIT';
  end if;

  insert into public.route_point_batches(
    route_session_id, player_id, batch_sequence, first_sequence, last_sequence,
    point_count, accepted_count, ignored_count, suspicious_count,
    idempotency_key, payload_hash, points, classification, response_payload, expires_at
  ) values (
    p_session_id, p_user_id, v_first_sequence, v_first_sequence, v_last_sequence,
    v_point_count, p_accepted_count, p_ignored_count, p_suspicious_count,
    p_idempotency_key, p_payload_hash, p_points,
    case when p_accepted_count = 0 then 'rejected' else 'accepted' end,
    p_response_payload,
    statement_timestamp() + make_interval(days => p_retention_days)
  );

  update public.route_sessions
  set last_received_sequence = v_last_sequence,
      last_accepted_sequence = p_last_accepted_sequence,
      point_count = point_count + p_accepted_count,
      suspicious_point_count = suspicious_point_count + p_suspicious_count,
      distance_m = distance_m + p_distance_increment_m,
      risk_score = least(100, risk_score + p_risk_delta),
      current_segment_index = p_segment_index,
      lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
      last_checkpoint_at = statement_timestamp()
  where id = p_session_id;

  if p_risk_delta > 0 then
    insert into public.risk_events(
      world_id, user_id, route_session_id, risk_code, severity, score_delta, evidence
    ) values (
      v_session.world_id, p_user_id, p_session_id, 'SUSPICIOUS_POINT_BATCH',
      case when p_risk_delta >= 20 then 'HIGH' else 'MEDIUM' end,
      least(100, p_risk_delta),
      jsonb_build_object('firstSequence', v_first_sequence, 'lastSequence', v_last_sequence)
    );
  end if;
  return p_response_payload;
end;
$$;

create or replace function app_private.tile_longitude(p_x bigint, p_zoom integer)
returns double precision
language sql
immutable
strict
set search_path = ''
as $$
  select (p_x::double precision / power(2::double precision, p_zoom)) * 360.0 - 180.0
$$;

create or replace function app_private.tile_latitude(p_y bigint, p_zoom integer)
returns double precision
language sql
immutable
strict
set search_path = ''
as $$
  select degrees(atan(sinh(pi() * (1.0 - (2.0 * p_y::double precision / power(2::double precision, p_zoom))))))
$$;

create or replace function app_private.tile_polygon(p_zoom integer, p_x bigint, p_y bigint)
returns extensions.geometry
language sql
immutable
strict
set search_path = ''
as $$
  select extensions.st_makeenvelope(
    app_private.tile_longitude(p_x, p_zoom),
    app_private.tile_latitude(p_y + 1, p_zoom),
    app_private.tile_longitude(p_x + 1, p_zoom),
    app_private.tile_latitude(p_y, p_zoom),
    4326
  )
$$;

create or replace function public.mrap_game_create_candidate(
  p_user_id uuid,
  p_session_id uuid,
  p_nonce_hash text,
  p_last_accepted_sequence bigint,
  p_start_sequence bigint,
  p_source text,
  p_source_segment_index integer,
  p_coordinates_hash text,
  p_polygon jsonb,
  p_estimated_area_m2 double precision,
  p_route_length_m double precision,
  p_proximity_threshold_m double precision,
  p_target_cell_ids text[],
  p_candidate_ttl_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.route_sessions%rowtype;
  v_world public.worlds%rowtype;
  v_rules app_private.game_rules%rowtype;
  v_existing public.loop_candidates%rowtype;
  v_candidate public.loop_candidates%rowtype;
  v_polygon extensions.geometry;
  v_start_point extensions.geometry;
  v_start_next_point extensions.geometry;
  v_end_previous_point extensions.geometry;
  v_end_point extensions.geometry;
  v_owned_geometry extensions.geometry;
  v_route_proof_count integer := 0;
  v_region_ids uuid[] := array[]::uuid[];
  v_source_region_ids uuid[] := array[]::uuid[];
  v_region_versions jsonb := '{}'::jsonb;
  v_source_region_versions jsonb := '{}'::jsonb;
  v_proximity_threshold_m double precision;
begin
  if p_source not in ('ACTIVE_ROUTE', 'OWN_TERRITORY')
     or p_source_segment_index < 0
     or p_coordinates_hash !~ '^[0-9a-f]{64}$'
     or p_candidate_ttl_seconds not between 30 and 3600
     or p_proximity_threshold_m <= 0
     or p_start_sequence < 1
     or p_last_accepted_sequence <= p_start_sequence
     or p_target_cell_ids is null then
    raise exception using errcode = '22023', message = 'INVALID_CANDIDATE_INPUT';
  end if;
  v_session := app_private.require_game_session(p_user_id, p_session_id, p_nonce_hash, true);
  if p_source_segment_index <> v_session.current_segment_index then
    raise exception using errcode = '40001', message = 'SEGMENT_CONFLICT';
  end if;
  if p_last_accepted_sequence <> v_session.last_accepted_sequence then
    raise exception using errcode = '22000', message = 'SEQUENCE_GAP';
  end if;
  select w.* into v_world from public.worlds w where w.id = v_session.world_id;
  select gr.* into v_rules from app_private.game_rules gr where gr.singleton = true;
  v_proximity_threshold_m := case v_session.location_mode
    when 'real_gps' then v_rules.real_gps_proximity_threshold_m
    when 'development_simulation' then v_rules.simulator_proximity_threshold_m
    else null
  end;
  -- The client may echo its configured value for drift detection, but it never
  -- chooses the authoritative geometry tolerance.
  if v_proximity_threshold_m is null
     or abs(p_proximity_threshold_m - v_proximity_threshold_m) > 0.001 then
    raise exception using errcode = '22023', message = 'PROXIMITY_RULE_MISMATCH';
  end if;
  if cardinality(p_target_cell_ids) < v_rules.minimum_claim_cell_count
     or cardinality(p_target_cell_ids) > v_rules.maximum_claim_cell_count
     or cardinality(p_target_cell_ids) <> (
       select count(distinct cell_id) from unnest(p_target_cell_ids) u(cell_id)
     ) then
    raise exception using errcode = '22023', message = 'INVALID_TARGET_CELL_SET';
  end if;

  begin
    v_polygon := extensions.st_setsrid(extensions.st_geomfromgeojson(p_polygon::text), 4326);
  exception when others then
    raise exception using errcode = '22023', message = 'INVALID_GEOMETRY';
  end;
  if extensions.st_geometrytype(v_polygon) <> 'ST_Polygon'
     or extensions.st_isempty(v_polygon)
     or not extensions.st_isvalid(v_polygon)
     or extensions.st_npoints(v_polygon) > v_rules.maximum_polygon_points
     or p_estimated_area_m2 < v_rules.minimum_claim_area_m2
     or p_estimated_area_m2 > v_rules.maximum_claim_area_m2
     or p_route_length_m < v_rules.minimum_route_length_m
     or abs(extensions.st_area(v_polygon::extensions.geography) - p_estimated_area_m2) > greatest(2, p_estimated_area_m2 * 0.02)
     or (v_world.supported_bounds is not null and not extensions.st_coveredby(v_polygon, v_world.supported_bounds)) then
    raise exception using errcode = '22023', message = 'INVALID_GEOMETRY';
  end if;

  select lc.* into v_existing
  from public.loop_candidates lc
  where lc.route_session_id = p_session_id and lc.end_sequence = p_last_accepted_sequence
  order by lc.detected_at_server desc limit 1 for update;
  if found then
    if v_existing.status = 'available' and v_existing.expires_at > statement_timestamp()
       and v_existing.coordinates_hash = p_coordinates_hash then
      return jsonb_build_object(
        'id', v_existing.id, 'sessionId', v_existing.route_session_id,
        'startSequence', v_existing.start_sequence, 'endSequence', v_existing.end_sequence,
        'sourceSegmentIndex', v_existing.source_segment_index,
        'coordinatesHash', v_existing.coordinates_hash,
        'estimatedAreaM2', v_existing.estimated_area_m2,
        'routeLengthM', v_existing.route_length_m,
        'detectedAtServer', v_existing.detected_at_server,
        'expiresAt', v_existing.expires_at, 'status', v_existing.status
      );
    end if;
    if v_existing.status = 'available' then
      perform app_private.compact_loop_candidate(v_existing.id, 'expired');
      return jsonb_build_object(
        'status', 'rejected',
        'errorCode', 'CANDIDATE_EXPIRED',
        'id', v_existing.id
      );
    end if;
    raise exception using errcode = '23505', message = 'CANDIDATE_CONFLICT';
  end if;

  -- Parse and validate the complete tile set relationally. Restrict decimal
  -- widths before bigint casts so malicious identifiers cannot overflow.
  if exists (
    select 1
    from unnest(p_target_cell_ids) as raw(cell_id)
    where raw.cell_id !~ '^(?:[1-9]|1[0-9]|2[0-6])/(?:0|[1-9][0-9]{0,17})/(?:0|[1-9][0-9]{0,17})$'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_CELL_ID';
  end if;

  if exists (
    with parsed as materialized (
      select
        raw.cell_id,
        split_part(raw.cell_id, '/', 1)::integer as zoom,
        split_part(raw.cell_id, '/', 2)::bigint as x,
        split_part(raw.cell_id, '/', 3)::bigint as y
      from unnest(p_target_cell_ids) as raw(cell_id)
    )
    select 1 from parsed p
    where p.zoom <> v_world.grid_resolution
       or p.x < 0 or p.y < 0
       or p.x >= power(2::numeric, p.zoom)
       or p.y >= power(2::numeric, p.zoom)
       or not extensions.st_covers(
         v_polygon,
         extensions.st_centroid(app_private.tile_polygon(p.zoom, p.x, p.y))
       )
  ) then
    raise exception using errcode = '22023', message = 'CELL_OUTSIDE_CANDIDATE';
  end if;

  -- Candidate creation persists only distinct region partitions. Canonical
  -- owner-null cells are deferred to the claim transaction, preventing an
  -- abandoned 25k-cell candidate from becoming a storage amplification vector.
  with parsed as materialized (
    select
      split_part(raw.cell_id, '/', 1)::integer as zoom,
      split_part(raw.cell_id, '/', 2)::bigint as x,
      split_part(raw.cell_id, '/', 3)::bigint as y
    from unnest(p_target_cell_ids) as raw(cell_id)
  ), region_keys as materialized (
    select distinct
      floor(p.x::numeric / power(2::numeric, p.zoom - v_world.region_resolution))::bigint as region_x,
      floor(p.y::numeric / power(2::numeric, p.zoom - v_world.region_resolution))::bigint as region_y
    from parsed p
  )
  insert into public.world_regions(world_id, region_key, name, geom)
  select
    v_world.id,
    v_world.region_resolution::text || '/' || rk.region_x::text || '/' || rk.region_y::text,
    'Bölge ' || v_world.region_resolution::text || '/' || rk.region_x::text || '/' || rk.region_y::text,
    extensions.st_multi(app_private.tile_polygon(v_world.region_resolution, rk.region_x, rk.region_y))
  from region_keys rk
  order by rk.region_x, rk.region_y
  on conflict (world_id, region_key) do nothing;

  with parsed as materialized (
    select
      split_part(raw.cell_id, '/', 1)::integer as zoom,
      split_part(raw.cell_id, '/', 2)::bigint as x,
      split_part(raw.cell_id, '/', 3)::bigint as y
    from unnest(p_target_cell_ids) as raw(cell_id)
  ), region_keys as materialized (
    select distinct
      v_world.region_resolution::text || '/' ||
        floor(p.x::numeric / power(2::numeric, p.zoom - v_world.region_resolution))::bigint::text || '/' ||
        floor(p.y::numeric / power(2::numeric, p.zoom - v_world.region_resolution))::bigint::text as region_key
    from parsed p
  )
  select
    array_agg(wr.id order by wr.id),
    jsonb_object_agg(wr.id::text, wr.version order by wr.id::text)
  into v_region_ids, v_region_versions
  from region_keys rk
  join public.world_regions wr
    on wr.world_id = v_world.id and wr.region_key = rk.region_key;

  if v_region_ids is null
     or cardinality(v_region_ids) < 1
     or cardinality(v_region_ids) > 256 then
    raise exception using errcode = '22023', message = 'INVALID_REGION_SET';
  end if;

  -- Resolve the exact accepted route anchors from server-written point JSON.
  select extensions.st_setsrid(extensions.st_makepoint(
    (point_value ->> 'longitude')::double precision,
    (point_value ->> 'latitude')::double precision
  ), 4326)
  into v_start_point
  from public.route_point_batches b
  cross join lateral jsonb_array_elements(b.points) as point_row(point_value)
  where b.route_session_id = p_session_id
    and (point_value ->> 'sequence')::bigint = p_start_sequence
    and (point_value ->> 'segmentIndex')::integer = p_source_segment_index
    and point_value ->> 'classification' in ('ACCEPTED', 'SUSPICIOUS')
  limit 1;

  select extensions.st_setsrid(extensions.st_makepoint(
    (point_value ->> 'longitude')::double precision,
    (point_value ->> 'latitude')::double precision
  ), 4326)
  into v_start_next_point
  from public.route_point_batches b
  cross join lateral jsonb_array_elements(b.points) as point_row(point_value)
  where b.route_session_id = p_session_id
    and (point_value ->> 'sequence')::bigint > p_start_sequence
    and (point_value ->> 'sequence')::bigint <= p_last_accepted_sequence
    and (point_value ->> 'segmentIndex')::integer = p_source_segment_index
    and point_value ->> 'classification' in ('ACCEPTED', 'SUSPICIOUS')
  order by (point_value ->> 'sequence')::bigint
  limit 1;

  select extensions.st_setsrid(extensions.st_makepoint(
    (point_value ->> 'longitude')::double precision,
    (point_value ->> 'latitude')::double precision
  ), 4326)
  into v_end_previous_point
  from public.route_point_batches b
  cross join lateral jsonb_array_elements(b.points) as point_row(point_value)
  where b.route_session_id = p_session_id
    and (point_value ->> 'sequence')::bigint >= p_start_sequence
    and (point_value ->> 'sequence')::bigint < p_last_accepted_sequence
    and (point_value ->> 'segmentIndex')::integer = p_source_segment_index
    and point_value ->> 'classification' in ('ACCEPTED', 'SUSPICIOUS')
  order by (point_value ->> 'sequence')::bigint desc
  limit 1;

  select extensions.st_setsrid(extensions.st_makepoint(
    (point_value ->> 'longitude')::double precision,
    (point_value ->> 'latitude')::double precision
  ), 4326)
  into v_end_point
  from public.route_point_batches b
  cross join lateral jsonb_array_elements(b.points) as point_row(point_value)
  where b.route_session_id = p_session_id
    and (point_value ->> 'sequence')::bigint = p_last_accepted_sequence
    and (point_value ->> 'segmentIndex')::integer = p_source_segment_index
    and point_value ->> 'classification' in ('ACCEPTED', 'SUSPICIOUS')
  limit 1;

  if v_start_point is null or v_end_point is null then
    raise exception using errcode = '22023', message = 'INVALID_ROUTE_SOURCE_CONTACT';
  end if;

  select count(distinct (point_value ->> 'sequence')::bigint)::integer
  into v_route_proof_count
  from public.route_point_batches b
  cross join lateral jsonb_array_elements(b.points) as point_row(point_value)
  where b.route_session_id = p_session_id
    and (point_value ->> 'sequence')::bigint between p_start_sequence and p_last_accepted_sequence
    and (point_value ->> 'segmentIndex')::integer = p_source_segment_index
    and point_value ->> 'classification' in ('ACCEPTED', 'SUSPICIOUS');

  if v_route_proof_count < v_rules.minimum_loop_point_count then
    raise exception using errcode = '22023', message = 'INVALID_ROUTE_SOURCE_CONTACT';
  end if;

  if p_source = 'ACTIVE_ROUTE' then
    if v_start_next_point is null or v_end_previous_point is null
       or not (
         extensions.st_intersects(
           extensions.st_makeline(v_start_point, v_start_next_point),
           extensions.st_makeline(v_end_previous_point, v_end_point)
         )
         or extensions.st_dwithin(
           v_end_point::extensions.geography,
           extensions.st_makeline(v_start_point, v_start_next_point)::extensions.geography,
           v_proximity_threshold_m
         )
       ) then
      raise exception using errcode = '22023', message = 'INVALID_ROUTE_SOURCE_CONTACT';
    end if;
  end if;

  if p_source = 'OWN_TERRITORY' then
    select array_agg(distinct tc.region_id order by tc.region_id)
    into v_source_region_ids
    from public.territory_cells tc
    where tc.world_id = v_world.id
      and tc.owner_id = p_user_id
      and (
        extensions.st_dwithin(
          tc.cell_geometry::extensions.geography,
          v_start_point::extensions.geography,
          v_proximity_threshold_m
        )
        or extensions.st_dwithin(
          tc.cell_geometry::extensions.geography,
          v_end_point::extensions.geography,
          v_proximity_threshold_m
        )
      );

    if v_source_region_ids is null or cardinality(v_source_region_ids) < 1 then
      raise exception using errcode = '22023', message = 'INVALID_OWNERSHIP_SOURCE_CONTACT';
    end if;

    -- Claims acquire these same partitions before changing ownership. Locking
    -- the anchor partitions makes the following dissolve+version snapshot
    -- internally consistent without exposing player coordinates.
    perform 1
    from public.world_regions wr
    where wr.world_id = v_world.id and wr.id = any(v_source_region_ids)
    order by wr.id
    for share;

    select extensions.st_unaryunion(extensions.st_collect(tc.cell_geometry))
    into v_owned_geometry
    from public.territory_cells tc
    where tc.world_id = v_world.id and tc.owner_id = p_user_id;

    if v_owned_geometry is null
       or extensions.st_isempty(v_owned_geometry)
       or not extensions.st_dwithin(
         v_start_point::extensions.geography,
         extensions.st_boundary(v_owned_geometry)::extensions.geography,
         v_proximity_threshold_m
       )
       or not extensions.st_dwithin(
         v_end_point::extensions.geography,
         extensions.st_boundary(v_owned_geometry)::extensions.geography,
         v_proximity_threshold_m
       ) then
      raise exception using errcode = '22023', message = 'INVALID_OWNERSHIP_SOURCE_CONTACT';
    end if;

    select jsonb_object_agg(wr.id::text, wr.version order by wr.id::text)
    into v_source_region_versions
    from public.world_regions wr
    where wr.world_id = v_world.id and wr.id = any(v_source_region_ids);
  end if;

  insert into public.loop_candidates(
    route_session_id, player_id, world_id, start_sequence, end_sequence,
    source_segment_index, coordinates_hash, raw_polygon, target_cell_ids,
    affected_region_ids, estimated_area_m2, route_length_m,
    proximity_threshold_m, status, validation_result, expires_at
  ) values (
    p_session_id, p_user_id, v_world.id, p_start_sequence, p_last_accepted_sequence,
    p_source_segment_index, p_coordinates_hash, v_polygon, p_target_cell_ids,
    v_region_ids, p_estimated_area_m2, p_route_length_m,
    v_proximity_threshold_m, 'available', jsonb_build_object(
      'source', p_source,
      'validatedBy', 'mrap-runtime-v15',
      'sourceStartPoint', extensions.st_asgeojson(v_start_point)::jsonb,
      'sourceEndPoint', extensions.st_asgeojson(v_end_point)::jsonb,
      'routeProofCount', v_route_proof_count,
      'detectedRegionVersions', v_region_versions,
      'sourceRegionVersions', v_source_region_versions
    ),
    statement_timestamp() + make_interval(secs => p_candidate_ttl_seconds)
  ) returning * into v_candidate;

  return jsonb_build_object(
    'id', v_candidate.id, 'sessionId', v_candidate.route_session_id,
    'startSequence', v_candidate.start_sequence, 'endSequence', v_candidate.end_sequence,
    'sourceSegmentIndex', v_candidate.source_segment_index,
    'coordinatesHash', v_candidate.coordinates_hash,
    'estimatedAreaM2', v_candidate.estimated_area_m2,
    'routeLengthM', v_candidate.route_length_m,
    'detectedAtServer', v_candidate.detected_at_server,
    'expiresAt', v_candidate.expires_at, 'status', v_candidate.status
  );
end;
$$;

create or replace function public.mrap_game_continue_candidate(
  p_user_id uuid,
  p_candidate_id uuid,
  p_nonce_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_candidate public.loop_candidates%rowtype;
  v_session public.route_sessions%rowtype;
  v_session_id uuid;
begin
  -- Discover the parent without a row lock, then follow the universal
  -- session-before-candidate lock order and re-check the relationship while
  -- both authoritative rows are protected.
  select lc.route_session_id into v_session_id
  from public.loop_candidates lc
  where lc.id = p_candidate_id and lc.player_id = p_user_id;
  if not found then raise exception using errcode = 'P0002', message = 'CANDIDATE_NOT_FOUND'; end if;
  v_session := app_private.require_game_session(p_user_id, v_session_id, p_nonce_hash, true);

  select lc.* into v_candidate
  from public.loop_candidates lc
  where lc.id = p_candidate_id
    and lc.player_id = p_user_id
    and lc.route_session_id = v_session.id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'CANDIDATE_NOT_FOUND'; end if;
  if v_candidate.status <> 'available' then
    raise exception using errcode = '55000', message = 'CANDIDATE_CONFLICT';
  end if;
  if v_candidate.expires_at <= statement_timestamp() then
    perform app_private.compact_loop_candidate(p_candidate_id, 'expired');
    return jsonb_build_object(
      'status', 'rejected',
      'errorCode', 'CANDIDATE_EXPIRED',
      'id', v_candidate.id
    );
  end if;
  perform app_private.compact_loop_candidate(p_candidate_id, 'continued');
  select lc.* into v_candidate
  from public.loop_candidates lc
  where lc.id = p_candidate_id;
  return jsonb_build_object(
    'id', v_candidate.id, 'sessionId', v_candidate.route_session_id,
    'startSequence', v_candidate.start_sequence, 'endSequence', v_candidate.end_sequence,
    'sourceSegmentIndex', v_candidate.source_segment_index,
    'coordinatesHash', v_candidate.coordinates_hash,
    'estimatedAreaM2', v_candidate.estimated_area_m2,
    'routeLengthM', v_candidate.route_length_m,
    'detectedAtServer', v_candidate.detected_at_server,
    'expiresAt', v_candidate.expires_at, 'status', v_candidate.status
  );
end;
$$;

create or replace function public.mrap_game_finish_session(
  p_user_id uuid,
  p_session_id uuid,
  p_nonce_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.route_sessions%rowtype;
  v_claim_count integer := 0;
  v_duration integer := 0;
begin
  v_session := app_private.require_game_session(p_user_id, p_session_id, p_nonce_hash, false);
  if v_session.status = 'revoked' then
    raise exception using errcode = '55000', message = 'SESSION_REVOKED';
  end if;
  select count(*)::integer into v_claim_count
  from public.claim_events ce
  where ce.route_session_id = p_session_id and ce.status = 'committed';

  if v_session.status = 'completed' then
    v_duration := v_session.duration_seconds;
  else
    if v_session.status not in ('active', 'paused', 'closing') then
      raise exception using errcode = '55000', message = 'INVALID_SESSION';
    end if;
    if v_session.lease_expires_at <= statement_timestamp() then
      perform app_private.compact_loop_candidate(candidate.id, 'expired')
      from (
        select lc.id
        from public.loop_candidates lc
        where lc.route_session_id = p_session_id and lc.status = 'available'
        order by lc.id
        for update
      ) candidate;
      update public.route_sessions
      set status = 'expired', ended_at = coalesce(ended_at, statement_timestamp())
      where id = p_session_id;
      return jsonb_build_object(
        'status', 'rejected',
        'errorCode', 'SESSION_EXPIRED'
      );
    end if;
    v_duration := least(86400, greatest(0, extract(epoch from (statement_timestamp() - v_session.started_at))::integer));
    perform app_private.compact_loop_candidate(candidate.id, 'expired')
    from (
      select lc.id
      from public.loop_candidates lc
      where lc.route_session_id = p_session_id and lc.status = 'available'
      order by lc.id
      for update
    ) candidate;
    update public.route_sessions
    set status = 'completed', ended_at = statement_timestamp(),
        duration_seconds = v_duration, updated_at = statement_timestamp()
    where id = p_session_id and status in ('active', 'paused', 'closing')
    returning * into v_session;
    if not found then raise exception using errcode = '40001', message = 'SESSION_CONFLICT'; end if;

    insert into public.player_scores(world_id, user_id, lifetime_distance_m)
    values (v_session.world_id, p_user_id, v_session.distance_m)
    on conflict (world_id, user_id) do update
    set lifetime_distance_m = public.player_scores.lifetime_distance_m + excluded.lifetime_distance_m;
  end if;

  return jsonb_build_object(
    'session', app_private.game_session_json(v_session),
    'route', jsonb_build_object(
      'distanceM', v_session.distance_m,
      'durationSeconds', v_duration,
      'acceptedPointCount', v_session.point_count,
      'closedClaimCount', v_claim_count
    )
  );
end;
$$;

create or replace function public.mrap_game_record_metric(
  p_metric_key text,
  p_amount integer default 1
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_metric_key !~ '^[a-z0-9_]{3,80}$' or p_amount < 1 or p_amount > 1000000 then
    raise exception using errcode = '22023', message = 'INVALID_METRIC';
  end if;
  insert into app_private.game_runtime_metrics(metric_key, metric_value)
  values (p_metric_key, p_amount)
  on conflict (metric_key) do update
  set metric_value = app_private.game_runtime_metrics.metric_value + excluded.metric_value,
      updated_at = statement_timestamp();
end;
$$;

create or replace function public.mrap_game_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', 'ok',
    'storage', 'supabase-postgres-authoritative',
    'pendingOutbox', (select count(*) from public.realtime_outbox ro where ro.status = 'pending'),
    'activeSessions', (
      select count(*) from public.route_sessions rs
      where rs.status in ('active', 'paused', 'closing') and rs.lease_expires_at > statement_timestamp()
    ),
    'metrics', coalesce((
      select jsonb_object_agg(m.metric_key, m.metric_value order by m.metric_key)
      from app_private.game_runtime_metrics m
    ), '{}'::jsonb),
    'checkedAt', statement_timestamp()
  )
$$;

-- Dissolve the grid before it reaches loop detection. Shared tile edges are
-- interior edges, not valid OWN_TERRITORY contact boundaries.
create or replace function public.mrap_game_owned_territory(
  p_user_id uuid,
  p_world_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with dissolved as (
    select extensions.st_collectionextract(
      extensions.st_unaryunion(extensions.st_collect(tc.cell_geometry)),
      3
    ) as geometry
    from public.territory_cells tc
    where tc.world_id = p_world_id and tc.owner_id = p_user_id
  )
  select jsonb_build_object(
    'geometry', case
      when d.geometry is null or extensions.st_isempty(d.geometry) then null
      else extensions.st_asgeojson(d.geometry)::jsonb
    end
  )
  from dissolved d
$$;

-- Render snapshots are derived server-side from the same authoritative cells,
-- but shared tile edges are dissolved before GeoJSON reaches MapLibre. The
-- optional region scope keeps viewport reads bounded without inventing seams
-- between adjacent cells inside the requested partition set.
create or replace function public.mrap_game_region_map_state(
  p_world_id uuid,
  p_region_ids uuid[] default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with scoped_cells as materialized (
    select
      tc.owner_id,
      tc.paint_color_id,
      tc.cell_geometry,
      tc.updated_at,
      p.username,
      p.color as owner_color,
      p.pattern as owner_pattern
    from public.territory_cells tc
    left join public.profiles p on p.id = tc.owner_id
    where tc.world_id = p_world_id
      and tc.owner_id is not null
      and p_region_ids is not null
      and cardinality(p_region_ids) between 1 and 256
      and tc.region_id = any(p_region_ids)
  ), ownership_collected as (
    select
      sc.owner_id,
      max(sc.username) as username,
      max(sc.owner_color) as owner_color,
      max(sc.owner_pattern) as owner_pattern,
      min(sc.paint_color_id) as fallback_color,
      max(sc.updated_at) as updated_at,
      extensions.st_collect(sc.cell_geometry) as collected_geometry
    from scoped_cells sc
    group by sc.owner_id
  ), ownership_dissolved as (
    select
      oc.*,
      extensions.st_multi(extensions.st_collectionextract(
        extensions.st_makevalid(extensions.st_unaryunion(oc.collected_geometry)),
        3
      )) as geometry
    from ownership_collected oc
  ), territory_payload as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'userId', od.owner_id,
      'ownerUsername', coalesce(od.username, 'mrap'),
      'geometry', extensions.st_asgeojson(od.geometry)::jsonb,
      'areaM2', extensions.st_area(od.geometry::extensions.geography),
      'color', coalesce(od.owner_color, od.fallback_color),
      'pattern', coalesce(od.owner_pattern, 0),
      'updatedAt', od.updated_at
    ) order by od.owner_id), '[]'::jsonb) as territories
    from ownership_dissolved od
    where not extensions.st_isempty(od.geometry)
      and extensions.st_isvalid(od.geometry)
  ), paint_collected as (
    select
      sc.owner_id,
      sc.paint_color_id,
      max(sc.updated_at) as updated_at,
      extensions.st_collect(sc.cell_geometry) as collected_geometry
    from scoped_cells sc
    where sc.paint_color_id is not null
    group by sc.owner_id, sc.paint_color_id
  ), paint_dissolved as (
    select
      pc.*,
      extensions.st_multi(extensions.st_collectionextract(
        extensions.st_makevalid(extensions.st_unaryunion(pc.collected_geometry)),
        3
      )) as geometry
    from paint_collected pc
  ), paint_payload as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(p_world_id::text || ':' || pd.owner_id::text || ':' || pd.paint_color_id),
      'userId', pd.owner_id,
      'geometry', extensions.st_asgeojson(pd.geometry)::jsonb,
      'color', pd.paint_color_id,
      'updatedAt', pd.updated_at
    ) order by pd.owner_id, pd.paint_color_id), '[]'::jsonb) as paints
    from paint_dissolved pd
    where not extensions.st_isempty(pd.geometry)
      and extensions.st_isvalid(pd.geometry)
  )
  select jsonb_build_object(
    'territories', tp.territories,
    'paints', pp.paints
  )
  from territory_payload tp
  cross join paint_payload pp
$$;

-- Public service-role bridge for the private Broadcast publisher. Polling is a
-- recovery path; committed outbox rows are proactively dispatched here.
create or replace function public.mrap_game_publish_outbox(p_limit integer default 100)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_published integer := 0;
  v_failed integer := 0;
  v_reconciled_worlds integer := 0;
begin
  select p.published_count, p.failed_count
  into v_published, v_failed
  from app_private.publish_realtime_outbox_batch(p_limit) p;

  -- Advance the legacy world high-water outside claim transactions. Effective
  -- reads are event-derived, so publisher downtime cannot lose a version.
  with effective as materialized (
    select ce.world_id, max(ce.world_version) as world_version
    from public.claim_events ce
    group by ce.world_id
  )
  update public.worlds w
  set current_version = greatest(w.current_version, effective.world_version)
  from effective
  where w.id = effective.world_id
    and w.current_version < effective.world_version;
  get diagnostics v_reconciled_worlds = row_count;

  return jsonb_build_object(
    'publishedCount', coalesce(v_published, 0),
    'failedCount', coalesce(v_failed, 0),
    'reconciledWorlds', v_reconciled_worlds,
    'processedAt', statement_timestamp()
  );
end;
$$;

-- Claim event versions are sequence-backed. Align the pre-existing sequence
-- with every legacy high-water mark before the upgraded claim body uses it.
do $$
declare
  v_high_water bigint;
begin
  select greatest(
    coalesce((select max(w.current_version) from public.worlds w), 0),
    coalesce((select max(ce.world_version) from public.claim_events ce), 0),
    coalesce((select last_value from public.world_version_seq), 0)
  ) into v_high_water;

  if v_high_water > 0 then
    perform setval('public.world_version_seq'::regclass, v_high_water, true);
  else
    perform setval('public.world_version_seq'::regclass, 1, false);
  end if;
end;
$$;

create or replace function public.mrap_game_effective_world_version(p_world_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((select w.current_version from public.worlds w where w.id = p_world_id), 0),
    coalesce((select max(ce.world_version) from public.claim_events ce where ce.world_id = p_world_id), 0)
  )
$$;

-- Upgrade phase-10's private claim implementation without editing migration
-- history. Every replacement is shape-checked so schema drift fails this
-- migration closed instead of silently retaining an unsafe old path.
do $claim_upgrade$
declare
  v_definition text;
  v_before text;
begin
  v_definition := pg_get_functiondef(
    'app_private.execute_claim_command(uuid,uuid,uuid,bigint,text,text,text,uuid)'::regprocedure
  );

  -- Lock the authoritative session and candidate before FK/idempotency rows can
  -- acquire reference locks in an ambiguous order.
  v_before := v_definition;
  v_definition := replace(v_definition, $old_session_preflight$
  select rs.* into v_session
  from public.route_sessions rs
  where rs.id = p_route_session_id;
$old_session_preflight$, $new_session_preflight$
  select rs.* into v_session
  from public.route_sessions rs
  where rs.id = p_route_session_id
    and rs.player_id = p_authoritative_user_id
  for update;
$new_session_preflight$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_SESSION_PREFLIGHT_SHAPE_MISMATCH';
  end if;

  v_before := v_definition;
  v_definition := replace(v_definition, $old_candidate_preflight$
  select lc.* into v_candidate
  from public.loop_candidates lc
  where lc.id = p_loop_candidate_id;
$old_candidate_preflight$, $new_candidate_preflight$
  select lc.* into v_candidate
  from public.loop_candidates lc
  where lc.id = p_loop_candidate_id
    and lc.player_id = p_authoritative_user_id
    and lc.route_session_id = v_session.id
  for update;
$new_candidate_preflight$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_CANDIDATE_PREFLIGHT_SHAPE_MISMATCH';
  end if;

  -- Remove the long-lived global world row lock. Re-locking session/candidate is
  -- harmless and documents the common session -> candidate -> region -> cell
  -- order inside the protected processing block.
  v_before := v_definition;
  v_definition := replace(v_definition, $old_lock_block$
    -- A world row lock gives the MVP a single, auditable commit order. Region
    -- and cell locks are still acquired in deterministic order so this can be
    -- sharded later without changing the conflict rule.
    select w.* into v_world
    from public.worlds w
    where w.id = v_session.world_id
    for update;

    if not found or v_world.status <> 'active' or not v_world.competitive_claims_enabled then
      raise exception 'WORLD_NOT_ACCEPTING_CLAIMS';
    end if;

    select rs.* into v_session
    from public.route_sessions rs
    where rs.id = p_route_session_id
    for update;

    select lc.* into v_candidate
    from public.loop_candidates lc
    where lc.id = p_loop_candidate_id
    for update;

    select gr.* into v_rules
    from app_private.game_rules gr
    where gr.singleton = true;
$old_lock_block$, $new_lock_block$
    select rs.* into v_session
    from public.route_sessions rs
    where rs.id = p_route_session_id
      and rs.player_id = p_authoritative_user_id
    for update;

    select lc.* into v_candidate
    from public.loop_candidates lc
    where lc.id = p_loop_candidate_id
      and lc.player_id = p_authoritative_user_id
      and lc.route_session_id = v_session.id
    for update;

    select w.* into v_world
    from public.worlds w
    where w.id = v_session.world_id;

    if not found or v_world.status <> 'active' or not v_world.competitive_claims_enabled then
      raise exception 'WORLD_NOT_ACCEPTING_CLAIMS';
    end if;

    select gr.* into v_rules
    from app_private.game_rules gr
    where gr.singleton = true;
$new_lock_block$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_LOCK_BLOCK_SHAPE_MISMATCH';
  end if;

  -- The request sequence is a client-observed watermark, not the immutable
  -- proof boundary. Users may keep moving while the nonmodal loop sheet is
  -- open; only the candidate's stored end/segment define claim geometry.
  v_before := v_definition;
  v_definition := replace(v_definition, $old_candidate_watermark$
    if p_last_accepted_point_sequence <> v_session.last_accepted_sequence
       or v_candidate.end_sequence > p_last_accepted_point_sequence then
      raise exception 'STALE_POINT_SEQUENCE';
    end if;
$old_candidate_watermark$, $new_candidate_watermark$
    if p_last_accepted_point_sequence < v_candidate.end_sequence
       or p_last_accepted_point_sequence > v_session.last_accepted_sequence
       or v_candidate.source_segment_index <> v_session.current_segment_index then
      raise exception 'STALE_POINT_SEQUENCE';
    end if;
$new_candidate_watermark$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_CANDIDATE_WATERMARK_SHAPE_MISMATCH';
  end if;

  -- Count only point-level accepted evidence in the candidate's segment; a
  -- mixed batch must not make every sequence in its numeric range trustworthy.
  v_before := v_definition;
  v_definition := replace(v_definition, $old_coverage$
    select count(distinct sequence_number)
    into v_covered_sequence_count
    from public.route_point_batches b
    cross join lateral generate_series(
      greatest(b.first_sequence, v_candidate.start_sequence),
      least(b.last_sequence, v_candidate.end_sequence)
    ) as sequence_number
    where b.route_session_id = v_session.id
      and b.classification = 'accepted'
      and b.first_sequence <= v_candidate.end_sequence
      and b.last_sequence >= v_candidate.start_sequence;
$old_coverage$, $new_coverage$
    select count(distinct (point_value ->> 'sequence')::bigint)
    into v_covered_sequence_count
    from public.route_point_batches b
    cross join lateral jsonb_array_elements(b.points) as point_row(point_value)
    where b.route_session_id = v_session.id
      and b.first_sequence <= v_candidate.end_sequence
      and b.last_sequence >= v_candidate.start_sequence
      and (point_value ->> 'classification') in ('ACCEPTED', 'SUSPICIOUS')
      and (point_value ->> 'segmentIndex')::integer = v_candidate.source_segment_index
      and (point_value ->> 'sequence')::bigint between
        v_candidate.start_sequence and v_candidate.end_sequence;
$new_coverage$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_POINT_COVERAGE_SHAPE_MISMATCH';
  end if;

  v_before := v_definition;
  v_definition := replace(v_definition, $old_coverage_threshold$
    if v_covered_sequence_count <
       (v_candidate.end_sequence - v_candidate.start_sequence + 1) then
      raise exception 'ROUTE_SEQUENCE_GAP';
    end if;
$old_coverage_threshold$, $new_coverage_threshold$
    if v_covered_sequence_count < greatest(
      v_rules.minimum_loop_point_count,
      coalesce(
        nullif(v_candidate.validation_result ->> 'routeProofCount', '')::integer,
        v_rules.minimum_loop_point_count
      )
    ) then
      raise exception 'ROUTE_SEQUENCE_GAP';
    end if;
$new_coverage_threshold$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_POINT_THRESHOLD_SHAPE_MISMATCH';
  end if;

  -- Materialize canonical cells only after the candidate is actually claimed.
  -- Rejections roll this subtransaction back, so abandoned candidates cannot
  -- leave permanent owner-null tiles behind.
  v_before := v_definition;
  v_definition := replace(v_definition, $old_cell_count$
    select count(*), count(distinct u.cell_id)
    into v_cell_count, v_distinct_cell_count
    from unnest(v_candidate.target_cell_ids) as u(cell_id);
$old_cell_count$, $new_cell_count$
    -- Lock partitions before inserting child cells. The FK otherwise takes a
    -- KEY SHARE lock first and two claims could deadlock while both upgrade the
    -- same region to FOR UPDATE.
    perform 1
    from public.world_regions wr
    where wr.world_id = v_world.id
      and (
        wr.id = any(v_candidate.affected_region_ids)
        or wr.id::text in (
          select source_region.region_id
          from jsonb_object_keys(coalesce(
            v_candidate.validation_result -> 'sourceRegionVersions',
            '{}'::jsonb
          )) as source_region(region_id)
        )
      )
    order by wr.id
    for update;

    with parsed as materialized (
      select
        raw.cell_id,
        split_part(raw.cell_id, '/', 1)::integer as zoom,
        split_part(raw.cell_id, '/', 2)::bigint as x,
        split_part(raw.cell_id, '/', 3)::bigint as y
      from unnest(v_candidate.target_cell_ids) as raw(cell_id)
      where raw.cell_id ~ '^(?:[1-9]|1[0-9]|2[0-6])/(?:0|[1-9][0-9]{0,17})/(?:0|[1-9][0-9]{0,17})$'
    ), cells as materialized (
      select
        p.cell_id,
        p.zoom,
        p.x,
        p.y,
        v_world.region_resolution::text || '/' ||
          floor(p.x::numeric / power(2::numeric, p.zoom - v_world.region_resolution))::bigint::text || '/' ||
          floor(p.y::numeric / power(2::numeric, p.zoom - v_world.region_resolution))::bigint::text as region_key,
        app_private.tile_polygon(p.zoom, p.x, p.y) as cell_geometry
      from parsed p
      where p.zoom = v_world.grid_resolution
        and p.x >= 0 and p.y >= 0
        and p.x < power(2::numeric, p.zoom)
        and p.y < power(2::numeric, p.zoom)
    )
    insert into public.territory_cells(
      world_id, cell_id, region_id, cell_geometry, center_point, area_m2
    )
    select
      v_world.id,
      c.cell_id,
      wr.id,
      c.cell_geometry,
      extensions.st_centroid(c.cell_geometry),
      extensions.st_area(c.cell_geometry::extensions.geography)
    from cells c
    join public.world_regions wr
      on wr.world_id = v_world.id and wr.region_key = c.region_key
    where extensions.st_covers(v_candidate.raw_polygon, extensions.st_centroid(c.cell_geometry))
    order by wr.id, c.cell_id
    on conflict (world_id, cell_id) do nothing;

    select count(*), count(distinct u.cell_id)
    into v_cell_count, v_distinct_cell_count
    from unnest(v_candidate.target_cell_ids) as u(cell_id);
$new_cell_count$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_CELL_MATERIALIZATION_SHAPE_MISMATCH';
  end if;

  -- Ownership-boundary candidates are invalidated if any locked source region
  -- changed since detection. This closes the read/create/claim TOCTOU window.
  v_before := v_definition;
  v_definition := replace(v_definition, $old_region_lock$
    perform 1
    from public.world_regions wr
    where wr.world_id = v_world.id
      and wr.id = any(v_region_ids)
    order by wr.id
    for update;
$old_region_lock$, $new_region_lock$
    perform 1
    from public.world_regions wr
    where wr.world_id = v_world.id
      and wr.id = any(v_region_ids)
    order by wr.id
    for update;

    if v_candidate.validation_result ->> 'source' = 'OWN_TERRITORY'
       and exists (
         select 1
         from jsonb_each_text(
           coalesce(v_candidate.validation_result -> 'detectedRegionVersions', '{}'::jsonb)
           || coalesce(v_candidate.validation_result -> 'sourceRegionVersions', '{}'::jsonb)
         ) detected(region_id, version)
         join public.world_regions wr on wr.id = detected.region_id::uuid
         where wr.world_id = v_world.id
           and wr.version <> detected.version::bigint
       ) then
      raise exception 'OWNERSHIP_BOUNDARY_CHANGED';
    end if;
$new_region_lock$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_REGION_LOCK_SHAPE_MISMATCH';
  end if;

  -- Serialize score reconciliation for claimant and every displaced owner.
  -- Without these locks, disjoint captures against the same victim can both
  -- publish a stale aggregate.
  v_before := v_definition;
  v_definition := replace(v_definition, $old_processing_marker$
    update public.claim_commands
    set status = 'PROCESSING'
    where id = v_command.id;
$old_processing_marker$, $new_processing_marker$
    insert into public.player_scores(world_id, user_id)
    select v_world.id, affected.user_id
    from (
      select p_authoritative_user_id as user_id
      union
      select distinct tc.owner_id
      from public.territory_cells tc
      where tc.world_id = v_world.id
        and tc.cell_id = any(v_candidate.target_cell_ids)
        and tc.owner_id is not null
    ) affected
    order by affected.user_id
    on conflict (world_id, user_id) do nothing;

    perform 1
    from public.player_scores ps
    where ps.world_id = v_world.id
      and ps.user_id in (
        select p_authoritative_user_id
        union
        select distinct tc.owner_id
        from public.territory_cells tc
        where tc.world_id = v_world.id
          and tc.cell_id = any(v_candidate.target_cell_ids)
          and tc.owner_id is not null
      )
    order by ps.user_id
    for update;

    update public.claim_commands
    set status = 'PROCESSING'
    where id = v_command.id;
$new_processing_marker$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_SCORE_LOCK_SHAPE_MISMATCH';
  end if;

  -- Allocate a globally monotonic event version without touching the shared
  -- world row in the claim hot path. Region versions remain the map authority;
  -- maintenance reconciles the legacy world high-water column.
  v_before := v_definition;
  v_definition := replace(v_definition, $old_world_version$
    update public.worlds
    set current_version = current_version + 1
    where id = v_world.id
    returning current_version into v_world_version;
$old_world_version$, $new_world_version$
    v_world_version := nextval('public.world_version_seq');
$new_world_version$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_WORLD_VERSION_SHAPE_MISMATCH';
  end if;

  -- Compact every terminal claim candidate only after all geometry-dependent
  -- writes finish. Claim events retain the committed polygon and claim command
  -- results retain the exact idempotent response.
  v_before := v_definition;
  v_definition := replace(v_definition, $old_noop_candidate$
      update public.loop_candidates
      set status = 'claimed'
      where id = v_candidate.id;
$old_noop_candidate$, $new_noop_candidate$
      perform app_private.compact_loop_candidate(v_candidate.id, 'claimed');
$new_noop_candidate$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_NOOP_COMPACTION_SHAPE_MISMATCH';
  end if;

  v_before := v_definition;
  v_definition := replace(v_definition, $old_claimed_candidate$
    update public.loop_candidates
    set status = 'claimed', claimed_event_id = v_event_id
    where id = v_candidate.id;
$old_claimed_candidate$, $new_claimed_candidate$
    perform app_private.compact_loop_candidate(v_candidate.id, 'claimed', v_event_id);
$new_claimed_candidate$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_COMMITTED_COMPACTION_SHAPE_MISMATCH';
  end if;

  v_before := v_definition;
  v_definition := replace(v_definition, $old_rejected_candidate$
      update public.claim_commands
      set
        status = v_command_status,
        error_code = v_error_code,
        result_payload = v_result,
        completed_at = now()
      where id = v_command.id;
$old_rejected_candidate$, $new_rejected_candidate$
      update public.claim_commands
      set
        status = v_command_status,
        error_code = v_error_code,
        result_payload = v_result,
        completed_at = now()
      where id = v_command.id;

      perform app_private.compact_loop_candidate(v_candidate.id, 'invalid');
$new_rejected_candidate$);
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_REJECTED_COMPACTION_SHAPE_MISMATCH';
  end if;

  -- Map the conservative ownership invalidation into the existing persistent
  -- rejection handler instead of leaking an internal exception.
  v_before := v_definition;
  v_definition := replace(v_definition,
    $old_error_case$        when 'RESTRICTED_REGION' then 'RESTRICTED_REGION'
        else 'CLAIM_INTERNAL_ERROR'$old_error_case$,
    $new_error_case$        when 'RESTRICTED_REGION' then 'RESTRICTED_REGION'
        when 'OWNERSHIP_BOUNDARY_CHANGED' then 'OWNERSHIP_BOUNDARY_CHANGED'
        else 'CLAIM_INTERNAL_ERROR'$new_error_case$
  );
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_ERROR_CASE_SHAPE_MISMATCH';
  end if;

  v_before := v_definition;
  v_definition := replace(v_definition,
    $old_route_status$          'REGION_NOT_WRITABLE'
        ) then 'REJECTED_INVALID_ROUTE'$old_route_status$,
    $new_route_status$          'REGION_NOT_WRITABLE', 'OWNERSHIP_BOUNDARY_CHANGED'
        ) then 'REJECTED_INVALID_ROUTE'$new_route_status$
  );
  if v_definition = v_before then
    raise exception 'CLAIM_UPGRADE_ERROR_STATUS_SHAPE_MISMATCH';
  end if;

  execute v_definition;
end;
$claim_upgrade$;

-- One bounded maintenance entry point preserves the phase-11 response contract
-- while also draining Broadcast and removing runtime-only sensitive artifacts.
-- Claim history is never a deletion root: referenced candidates are excluded.
create or replace function public.purge_expired_location_data(p_limit integer default 25000)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25000), 1), 50000);
  v_deleted_batches integer := 0;
  v_expired_sessions integer := 0;
  v_expired_candidates integer := 0;
  v_compacted_candidates integer := 0;
  v_deleted_candidates integer := 0;
  v_deleted_unowned_cells integer := 0;
  v_deleted_outbox integer := 0;
  v_published integer := 0;
  v_publish_failed integer := 0;
  v_reconciled_worlds integer := 0;
  v_has_more boolean := false;
begin
  select p.published_count, p.failed_count
  into v_published, v_publish_failed
  from app_private.publish_realtime_outbox_batch(least(v_limit, 500)) p;

  with stale as materialized (
    select rs.id
    from public.route_sessions rs
    where rs.status in ('active', 'paused', 'closing')
      and rs.lease_expires_at <= statement_timestamp()
    order by rs.id
    limit v_limit
    for update skip locked
  )
  update public.route_sessions rs
  set status = 'expired',
      ended_at = coalesce(rs.ended_at, statement_timestamp()),
      updated_at = statement_timestamp()
  from stale
  where rs.id = stale.id;
  get diagnostics v_expired_sessions = row_count;

  with stale as materialized (
    select lc.id
    from public.loop_candidates lc
    where lc.status = 'available'
      and lc.expires_at <= statement_timestamp()
    order by lc.id
    limit v_limit
    for update skip locked
  )
  update public.loop_candidates lc
  set status = 'expired',
      raw_polygon = extensions.st_geomfromtext(
        'POLYGON((0 0,0 0.000001,0.000001 0,0 0))',
        4326
      ),
      target_cell_ids = array['redacted']::text[],
      affected_region_ids = array['00000000-0000-0000-0000-000000000000'::uuid],
      validation_result = (
        lc.validation_result
          - 'sourceStartPoint'
          - 'sourceEndPoint'
          - 'detectedRegionVersions'
          - 'sourceRegionVersions'
      ) || jsonb_build_object(
        'payloadCompacted', true,
        'compactedAt', statement_timestamp()
      )
  from stale
  where lc.id = stale.id;
  get diagnostics v_expired_candidates = row_count;

  -- Backfill compaction for terminal candidates created before this migration
  -- and for claimed/rejected records retained by audit foreign keys.
  with terminal as materialized (
    select lc.id
    from public.loop_candidates lc
    where lc.status in ('claimed', 'continued', 'expired', 'invalid')
      and coalesce((lc.validation_result ->> 'payloadCompacted')::boolean, false) = false
    order by lc.detected_at_server, lc.id
    limit v_limit
    for update skip locked
  )
  update public.loop_candidates lc
  set raw_polygon = extensions.st_geomfromtext(
        'POLYGON((0 0,0 0.000001,0.000001 0,0 0))',
        4326
      ),
      target_cell_ids = array['redacted']::text[],
      affected_region_ids = array['00000000-0000-0000-0000-000000000000'::uuid],
      validation_result = (
        lc.validation_result
          - 'sourceStartPoint'
          - 'sourceEndPoint'
          - 'detectedRegionVersions'
          - 'sourceRegionVersions'
      ) || jsonb_build_object(
        'payloadCompacted', true,
        'compactedAt', statement_timestamp()
      )
  from terminal
  where lc.id = terminal.id;
  get diagnostics v_compacted_candidates = row_count;

  with doomed as materialized (
    select b.id
    from public.route_point_batches b
    where b.expires_at <= statement_timestamp()
    order by b.expires_at, b.id
    limit v_limit
    for update skip locked
  )
  delete from public.route_point_batches b
  using doomed
  where b.id = doomed.id;
  get diagnostics v_deleted_batches = row_count;

  with doomed as materialized (
    select lc.id
    from public.loop_candidates lc
    where lc.status in ('continued', 'expired', 'invalid')
      and lc.detected_at_server <= statement_timestamp() - interval '24 hours'
      and not exists (
        select 1 from public.claim_commands cc where cc.loop_candidate_id = lc.id
      )
      and not exists (
        select 1 from public.claim_events ce where ce.loop_candidate_id = lc.id
      )
    order by lc.detected_at_server, lc.id
    limit v_limit
    for update skip locked
  )
  delete from public.loop_candidates lc
  using doomed
  where lc.id = doomed.id;
  get diagnostics v_deleted_candidates = row_count;

  -- Cleans legacy candidate materialization. New candidates do not create these
  -- rows until claim time, but this guard also bounds any interrupted old flow.
  with doomed as materialized (
    select tc.world_id, tc.cell_id
    from public.territory_cells tc
    where tc.owner_id is null
      and tc.updated_at <= statement_timestamp() - interval '1 hour'
      and not exists (
        select 1
        from public.loop_candidates lc
        where lc.world_id = tc.world_id
          and lc.status in ('available', 'accepted')
          and tc.cell_id = any(lc.target_cell_ids)
      )
    order by tc.world_id, tc.cell_id
    limit v_limit
    for update skip locked
  )
  delete from public.territory_cells tc
  using doomed
  where tc.world_id = doomed.world_id and tc.cell_id = doomed.cell_id;
  get diagnostics v_deleted_unowned_cells = row_count;

  with doomed as materialized (
    select ro.id
    from public.realtime_outbox ro
    where (
      ro.status = 'published'
      and ro.published_at <= statement_timestamp() - interval '7 days'
    ) or (
      ro.status = 'dead_letter'
      and ro.created_at <= statement_timestamp() - interval '30 days'
    )
    order by coalesce(ro.published_at, ro.created_at), ro.id
    limit v_limit
    for update skip locked
  )
  delete from public.realtime_outbox ro
  using doomed
  where ro.id = doomed.id;
  get diagnostics v_deleted_outbox = row_count;

  -- This is deliberately outside the claim hot path. Effective version reads
  -- remain event-derived; this update only advances the legacy column.
  with effective as materialized (
    select ce.world_id, max(ce.world_version) as world_version
    from public.claim_events ce
    group by ce.world_id
  )
  update public.worlds w
  set current_version = greatest(w.current_version, effective.world_version)
  from effective
  where w.id = effective.world_id
    and w.current_version < effective.world_version;
  get diagnostics v_reconciled_worlds = row_count;

  select
    exists (
      select 1 from public.route_point_batches b
      where b.expires_at <= statement_timestamp()
    )
    or exists (
      select 1 from public.route_sessions rs
      where rs.status in ('active', 'paused', 'closing')
        and rs.lease_expires_at <= statement_timestamp()
    )
    or exists (
      select 1 from public.loop_candidates lc
      where lc.status = 'available' and lc.expires_at <= statement_timestamp()
    )
    or exists (
      select 1 from public.loop_candidates lc
      where lc.status in ('claimed', 'continued', 'expired', 'invalid')
        and coalesce((lc.validation_result ->> 'payloadCompacted')::boolean, false) = false
    )
    or exists (
      select 1 from public.loop_candidates lc
      where lc.status in ('continued', 'expired', 'invalid')
        and lc.detected_at_server <= statement_timestamp() - interval '24 hours'
        and not exists (
          select 1 from public.claim_commands cc where cc.loop_candidate_id = lc.id
        )
    )
    or exists (
      select 1 from public.realtime_outbox ro
      where (ro.status = 'published' and ro.published_at <= statement_timestamp() - interval '7 days')
         or (ro.status = 'dead_letter' and ro.created_at <= statement_timestamp() - interval '30 days')
    )
  into v_has_more;

  return jsonb_build_object(
    'deletedBatches', v_deleted_batches,
    'expiredSessions', v_expired_sessions,
    'expiredCandidates', v_expired_candidates,
    'compactedCandidates', v_compacted_candidates,
    'deletedCandidates', v_deleted_candidates,
    'deletedUnownedCells', v_deleted_unowned_cells,
    'deletedOutbox', v_deleted_outbox,
    'publishedOutbox', coalesce(v_published, 0),
    'failedOutbox', coalesce(v_publish_failed, 0),
    'reconciledWorlds', v_reconciled_worlds,
    'hasMore', v_has_more,
    'completedAt', statement_timestamp()
  );
end;
$$;

-- Keep the deployment contract machine-verifiable before production claims
-- are enabled.
create or replace function app_private.runtime_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', 15,
    'productionWorldSlug', (
      select w.slug::text from public.worlds w
      where w.id = '00000000-0000-4000-8000-000000000001'::uuid
    ),
    'gridResolution', (
      select w.grid_resolution from public.worlds w
      where w.id = '00000000-0000-4000-8000-000000000001'::uuid
    ),
    'regionResolution', (
      select w.region_resolution from public.worlds w
      where w.id = '00000000-0000-4000-8000-000000000001'::uuid
    ),
    'postClaimEventReady', exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'posts' and c.column_name = 'claim_event_id'
    ),
    'distributedRateLimitReady', to_regclass('app_private.api_rate_limits') is not null,
    'authoritativeRules', (
      select jsonb_build_object(
        'minimumClaimAreaM2', gr.minimum_claim_area_m2,
        'maximumClaimAreaM2', gr.maximum_claim_area_m2,
        'minimumRouteLengthM', gr.minimum_route_length_m,
        'maximumCompetitiveRiskScore', gr.maximum_competitive_risk_score,
        'maximumPolygonPoints', gr.maximum_polygon_points,
        'maximumRoutePoints', gr.maximum_route_points,
        'maximumGpsAccuracyM', gr.maximum_gps_accuracy_m,
        'maximumPlausibleSpeedMps', gr.maximum_plausible_speed_mps,
        'realGpsProximityThresholdM', gr.real_gps_proximity_threshold_m,
        'simulatorProximityThresholdM', gr.simulator_proximity_threshold_m,
        'minimumClaimCells', gr.minimum_claim_cell_count,
        'maximumInlinePatchCells', gr.realtime_patch_cell_limit,
        'maximumClaimCells', gr.maximum_claim_cell_count,
        'maximumBatchPoints', gr.maximum_batch_points,
        'maximumBatchBytes', gr.maximum_batch_bytes,
        'sessionLeaseSeconds', gr.session_lease_seconds,
        'offlineGraceSeconds', gr.offline_grace_seconds,
        'rawPointRetentionDays', gr.raw_point_retention_days,
        'claimRateWindowSeconds', gr.claim_rate_window_seconds,
        'claimRateMaxCommands', gr.claim_rate_max_commands,
        'paintCooldownSeconds', gr.paint_cooldown_seconds,
        'minimumLoopPointCount', gr.minimum_loop_point_count
      )
      from app_private.game_rules gr where gr.singleton = true
    ),
    'outboxPublisherReady',
      to_regprocedure('public.mrap_game_publish_outbox(integer)') is not null,
    'dissolvedTerritoryReady',
      to_regprocedure('public.mrap_game_owned_territory(uuid,uuid)') is not null,
    'regionMapStateReady',
      to_regprocedure('public.mrap_game_region_map_state(uuid,uuid[])') is not null,
    'authoritativeGameRuntimeReady',
      to_regprocedure('public.mrap_game_start_session(uuid,text,text,text,integer,uuid)') is not null
      and to_regprocedure('public.mrap_game_append_point_batch(uuid,uuid,text,text,text,jsonb,integer,integer,integer,bigint,double precision,numeric,integer,jsonb,integer,integer)') is not null
      and to_regprocedure('public.mrap_game_create_candidate(uuid,uuid,text,bigint,bigint,text,integer,text,jsonb,double precision,double precision,double precision,text[],integer)') is not null
      and to_regprocedure('public.mrap_game_owned_territory(uuid,uuid)') is not null
      and to_regprocedure('public.mrap_game_region_map_state(uuid,uuid[])') is not null
      and to_regprocedure('public.mrap_game_publish_outbox(integer)') is not null
  )
$$;

-- Private helpers remain unreachable through the exposed Data API.
revoke all on function app_private.game_session_json(public.route_sessions) from public, anon, authenticated;
revoke all on function app_private.require_game_session(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function app_private.compact_loop_candidate(uuid, text, uuid) from public, anon, authenticated;
revoke all on function app_private.tile_longitude(bigint, integer) from public, anon, authenticated;
revoke all on function app_private.tile_latitude(bigint, integer) from public, anon, authenticated;
revoke all on function app_private.tile_polygon(integer, bigint, bigint) from public, anon, authenticated;

revoke all on function public.mrap_game_start_session(uuid, text, text, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.mrap_game_takeover_session(uuid, text, text, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.mrap_game_begin_segment(uuid, uuid, text, integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.mrap_game_revoke_sessions(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mrap_game_append_point_batch(uuid, uuid, text, text, text, jsonb, integer, integer, integer, bigint, double precision, numeric, integer, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.mrap_game_create_candidate(uuid, uuid, text, bigint, bigint, text, integer, text, jsonb, double precision, double precision, double precision, text[], integer) from public, anon, authenticated;
revoke all on function public.mrap_game_continue_candidate(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mrap_game_finish_session(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mrap_game_record_metric(text, integer) from public, anon, authenticated;
revoke all on function public.mrap_game_health() from public, anon, authenticated;
revoke all on function public.mrap_game_owned_territory(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mrap_game_region_map_state(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.mrap_game_publish_outbox(integer) from public, anon, authenticated;
revoke all on function public.mrap_game_effective_world_version(uuid) from public, anon, authenticated;
revoke all on function public.purge_expired_location_data(integer) from public, anon, authenticated;

grant execute on function public.mrap_game_start_session(uuid, text, text, text, integer, uuid) to service_role;
grant execute on function public.mrap_game_takeover_session(uuid, text, text, text, integer, uuid) to service_role;
grant execute on function public.mrap_game_begin_segment(uuid, uuid, text, integer, integer, uuid) to service_role;
grant execute on function public.mrap_game_revoke_sessions(uuid, uuid) to service_role;
grant execute on function public.mrap_game_append_point_batch(uuid, uuid, text, text, text, jsonb, integer, integer, integer, bigint, double precision, numeric, integer, jsonb, integer, integer) to service_role;
grant execute on function public.mrap_game_create_candidate(uuid, uuid, text, bigint, bigint, text, integer, text, jsonb, double precision, double precision, double precision, text[], integer) to service_role;
grant execute on function public.mrap_game_continue_candidate(uuid, uuid, text) to service_role;
grant execute on function public.mrap_game_finish_session(uuid, uuid, text) to service_role;
grant execute on function public.mrap_game_record_metric(text, integer) to service_role;
grant execute on function public.mrap_game_health() to service_role;
grant execute on function public.mrap_game_owned_territory(uuid, uuid) to service_role;
grant execute on function public.mrap_game_region_map_state(uuid, uuid[]) to service_role;
grant execute on function public.mrap_game_publish_outbox(integer) to service_role;
grant execute on function public.mrap_game_effective_world_version(uuid) to service_role;
grant execute on function public.purge_expired_location_data(integer) to service_role;

comment on function public.mrap_game_append_point_batch(uuid, uuid, text, text, text, jsonb, integer, integer, integer, bigint, double precision, numeric, integer, jsonb, integer, integer) is
  'Trusted idempotent GPS batch transaction. Browser roles have no execute grant.';
comment on function public.mrap_game_create_candidate(uuid, uuid, text, bigint, bigint, text, integer, text, jsonb, double precision, double precision, double precision, text[], integer) is
  'Validates canonical grid cells set-wise and stores an immutable server-detected loop candidate; cell materialization is deferred to claim.';
comment on function public.mrap_game_owned_territory(uuid, uuid) is
  'Returns dissolved current territory GeoJSON for trusted loop source detection.';
comment on function public.mrap_game_publish_outbox(integer) is
  'Bounded service-role Broadcast publisher bridge with durable polling fallback.';

commit;
