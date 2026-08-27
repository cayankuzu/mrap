-- mrap production schema, phase 8: server-authoritative multiplayer core.
--
-- The authoritative ownership model is a configurable deterministic grid.  No
-- H3/S2 database extension is assumed: a trusted grid adapter materializes
-- stable cell_id values, boundaries and centre points before a claim can use
-- them.  Polygon geometry remains evidence/rendering data, never the ownership
-- source of truth.

create table public.worlds (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique
    check (slug::text ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  name text not null check (char_length(trim(name)) between 2 and 80),
  environment text not null
    check (environment in ('production', 'sandbox')),
  status text not null default 'active'
    check (status in ('draft', 'active', 'maintenance', 'archived')),
  grid_scheme text not null
    check (grid_scheme ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  grid_resolution smallint not null check (grid_resolution between 0 and 30),
  grid_definition_version integer not null default 1
    check (grid_definition_version > 0),
  current_version bigint not null default 0 check (current_version >= 0),
  allow_simulated_location boolean not null default false,
  competitive_claims_enabled boolean not null default false,
  supported_bounds extensions.geometry(MultiPolygon, 4326),
  rules jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (environment <> 'production' or allow_simulated_location = false),
  check (
    supported_bounds is null
    or (
      not extensions.st_isempty(supported_bounds)
      and extensions.st_isvalid(supported_bounds)
      and extensions.st_srid(supported_bounds) = 4326
    )
  )
);

create index worlds_status_environment_idx
  on public.worlds(status, environment, slug);
create index worlds_supported_bounds_gix
  on public.worlds using gist(supported_bounds)
  where supported_bounds is not null;

create trigger worlds_set_updated_at
before update on public.worlds
for each row execute function app_private.set_updated_at();

insert into public.worlds(
  id,
  slug,
  name,
  environment,
  status,
  grid_scheme,
  grid_resolution,
  allow_simulated_location,
  competitive_claims_enabled,
  supported_bounds
)
values
  (
    '00000000-0000-4000-8000-000000000001',
    'mrap-world',
    'mrap ortak dünya',
    'production',
    'draft',
    'mrap-grid-v1',
    18,
    false,
    false,
    extensions.st_multi(extensions.st_makeenvelope(-180, -85, 180, 85, 4326))
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'mrap-sandbox',
    'mrap geliştirme dünyası',
    'sandbox',
    'active',
    'mrap-grid-v1',
    18,
    true,
    true,
    extensions.st_multi(extensions.st_makeenvelope(-180, -85, 180, 85, 4326))
  )
on conflict (id) do nothing;

create table public.world_regions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds(id) on delete restrict,
  region_key text not null
    check (region_key ~ '^[a-z0-9][a-z0-9:_./-]{2,127}$'),
  name text not null check (char_length(trim(name)) between 2 and 100),
  status text not null default 'active'
    check (status in ('active', 'read_only', 'disabled')),
  version bigint not null default 0 check (version >= 0),
  geom extensions.geometry(MultiPolygon, 4326) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (world_id, region_key),
  unique (id, world_id),
  check (
    not extensions.st_isempty(geom)
    and extensions.st_isvalid(geom)
    and extensions.st_srid(geom) = 4326
  )
);

create index world_regions_world_status_idx
  on public.world_regions(world_id, status, region_key);
create index world_regions_geom_gix
  on public.world_regions using gist(geom);

create trigger world_regions_set_updated_at
before update on public.world_regions
for each row execute function app_private.set_updated_at();

insert into public.world_regions(id, world_id, region_key, name, geom)
values
  (
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000000001',
    'bootstrap-global',
    'Üretim bootstrap bölgesi',
    extensions.st_multi(extensions.st_makeenvelope(-180, -85, 180, 85, 4326))
  ),
  (
    '00000000-0000-4000-8000-000000001002',
    '00000000-0000-4000-8000-000000000002',
    'bootstrap-global',
    'Sandbox bootstrap bölgesi',
    extensions.st_multi(extensions.st_makeenvelope(-180, -85, 180, 85, 4326))
  )
on conflict (id) do nothing;

create table public.territory_cells (
  world_id uuid not null references public.worlds(id) on delete restrict,
  cell_id text not null
    check (
      char_length(cell_id) between 3 and 128
      and cell_id ~ '^[a-z0-9][a-z0-9:_./-]+$'
    ),
  region_id uuid not null,
  cell_geometry extensions.geometry(Polygon, 4326) not null,
  center_point extensions.geometry(Point, 4326) not null,
  area_m2 numeric(18, 6) not null check (area_m2 > 0),
  owner_id uuid references public.profiles(id) on delete set null,
  paint_color_id text check (
    paint_color_id is null
    or paint_color_id ~ '^(#[0-9A-F]{6}|[a-z][a-z0-9_]{2,31})$'
  ),
  ownership_version bigint not null default 0 check (ownership_version >= 0),
  paint_version bigint not null default 0 check (paint_version >= 0),
  last_claim_event_id uuid,
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (world_id, cell_id),
  foreign key (region_id, world_id)
    references public.world_regions(id, world_id) on delete restrict,
  check (
    not extensions.st_isempty(cell_geometry)
    and extensions.st_isvalid(cell_geometry)
    and extensions.st_srid(cell_geometry) = 4326
    and extensions.st_srid(center_point) = 4326
    and extensions.st_covers(cell_geometry, center_point)
  ),
  check (owner_id is not null or paint_color_id is null)
);

create index territory_cells_region_version_idx
  on public.territory_cells(world_id, region_id, ownership_version, cell_id);
create index territory_cells_owner_idx
  on public.territory_cells(world_id, owner_id, cell_id)
  where owner_id is not null;
create index territory_cells_geometry_gix
  on public.territory_cells using gist(cell_geometry);
create index territory_cells_center_gix
  on public.territory_cells using gist(center_point);

create or replace function app_private.normalize_territory_cell()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is null then
    new.paint_color_id := null;
    new.claimed_at := null;
  elsif new.paint_color_id like '#%' then
    new.paint_color_id := upper(new.paint_color_id);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger territory_cells_normalize
before insert or update on public.territory_cells
for each row execute function app_private.normalize_territory_cell();

-- Extend the aggregate-only route_sessions table from phase 6 into a leased,
-- server-issued session without dropping historical rows.
alter table public.route_sessions
  add column world_id uuid references public.worlds(id) on delete restrict;
alter table public.route_sessions
  add column session_kind text not null default 'competitive';
alter table public.route_sessions
  add column status text not null default 'completed';
alter table public.route_sessions
  add column server_nonce text;
alter table public.route_sessions
  add column last_accepted_sequence bigint not null default 0;
alter table public.route_sessions
  add column lease_expires_at timestamptz;
alter table public.route_sessions
  add column last_checkpoint_at timestamptz;
alter table public.route_sessions
  add column risk_score numeric(6, 3) not null default 0;
alter table public.route_sessions
  add column revoked_reason text;
alter table public.route_sessions
  add column updated_at timestamptz not null default now();

alter table public.route_sessions
  alter column distance_m set default 0,
  alter column duration_seconds set default 0,
  alter column point_count set default 0,
  alter column ended_at drop not null;

alter table public.route_sessions
  drop constraint if exists route_sessions_location_mode_check;
alter table public.route_sessions
  drop constraint if exists route_sessions_point_count_check;

update public.route_sessions
set
  world_id = case
    when location_mode = 'simulation'
      then '00000000-0000-4000-8000-000000000002'::uuid
    else '00000000-0000-4000-8000-000000000001'::uuid
  end,
  location_mode = case
    when location_mode = 'simulation' then 'development_simulation'
    else 'real_gps'
  end,
  server_nonce = replace(gen_random_uuid()::text, '-', ''),
  lease_expires_at = coalesce(ended_at, started_at) + interval '5 minutes',
  last_checkpoint_at = coalesce(ended_at, started_at)
where world_id is null or server_nonce is null;

alter table public.route_sessions
  alter column world_id set not null,
  alter column server_nonce set not null,
  alter column status set default 'active';

alter table public.route_sessions
  add constraint route_sessions_location_mode_v2_check
    check (location_mode in ('real_gps', 'development_simulation')),
  add constraint route_sessions_kind_check
    check (session_kind in ('competitive', 'activity')),
  add constraint route_sessions_status_check
    check (status in ('active', 'paused', 'closing', 'completed', 'expired', 'revoked')),
  add constraint route_sessions_nonce_check
    check (server_nonce ~ '^[A-Za-z0-9_-]{24,128}$'),
  add constraint route_sessions_last_sequence_check
    check (last_accepted_sequence >= 0),
  add constraint route_sessions_point_count_v2_check
    check (point_count between 0 and 50000),
  add constraint route_sessions_risk_score_check
    check (risk_score between 0 and 100),
  add constraint route_sessions_lease_check
    check (
      (status in ('completed', 'expired', 'revoked'))
      or (lease_expires_at is not null and lease_expires_at > started_at)
    ),
  add constraint route_sessions_id_player_unique unique (id, player_id),
  add constraint route_sessions_id_player_world_unique unique (id, player_id, world_id);

create unique index route_sessions_one_live_competitive_idx
  on public.route_sessions(player_id, world_id)
  where session_kind = 'competitive'
    and status in ('active', 'paused', 'closing');
create index route_sessions_world_status_lease_idx
  on public.route_sessions(world_id, status, lease_expires_at)
  where status in ('active', 'paused', 'closing');

create trigger route_sessions_set_updated_at
before update on public.route_sessions
for each row execute function app_private.set_updated_at();

create table public.route_point_batches (
  id uuid primary key default gen_random_uuid(),
  route_session_id uuid not null references public.route_sessions(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  batch_sequence bigint not null check (batch_sequence >= 0),
  first_sequence bigint not null check (first_sequence >= 1),
  last_sequence bigint not null check (last_sequence >= first_sequence),
  point_count integer not null check (point_count between 1 and 512),
  accepted_count integer not null default 0 check (accepted_count between 0 and 512),
  ignored_count integer not null default 0 check (ignored_count between 0 and 512),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  points jsonb not null
    check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) = point_count),
  classification text not null default 'received'
    check (classification in ('received', 'accepted', 'partial', 'suspicious', 'rejected')),
  server_received_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique (route_session_id, batch_sequence),
  unique (route_session_id, first_sequence, last_sequence),
  foreign key (route_session_id, player_id)
    references public.route_sessions(id, player_id) on delete cascade,
  check (last_sequence - first_sequence + 1 = point_count),
  check (accepted_count + ignored_count <= point_count),
  check (octet_length(points::text) <= 262144)
);

create index route_point_batches_session_range_idx
  on public.route_point_batches(route_session_id, first_sequence, last_sequence);
create index route_point_batches_retention_idx
  on public.route_point_batches(expires_at);
create index route_point_batches_player_received_idx
  on public.route_point_batches(player_id, server_received_at desc);

create table public.loop_candidates (
  id uuid primary key default gen_random_uuid(),
  route_session_id uuid not null references public.route_sessions(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  world_id uuid not null references public.worlds(id) on delete restrict,
  start_sequence bigint not null check (start_sequence >= 1),
  end_sequence bigint not null check (end_sequence > start_sequence),
  source_segment_index integer not null check (source_segment_index >= 0),
  coordinates_hash text not null check (coordinates_hash ~ '^[0-9a-f]{64}$'),
  raw_polygon extensions.geometry(Polygon, 4326) not null,
  target_cell_ids text[] not null,
  affected_region_ids uuid[] not null,
  estimated_area_m2 numeric(18, 6) not null check (estimated_area_m2 > 0),
  route_length_m numeric(18, 3) not null check (route_length_m > 0),
  proximity_threshold_m numeric(8, 3) not null check (proximity_threshold_m > 0),
  status text not null default 'available'
    check (status in ('available', 'accepted', 'continued', 'expired', 'invalid', 'claimed')),
  validation_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(validation_result) = 'object'),
  detected_at_server timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_event_id uuid,
  unique (route_session_id, coordinates_hash),
  unique (id, player_id, world_id, route_session_id),
  foreign key (route_session_id, player_id, world_id)
    references public.route_sessions(id, player_id, world_id) on delete cascade,
  check (cardinality(target_cell_ids) between 1 and 50000),
  check (cardinality(affected_region_ids) between 1 and 256),
  check (expires_at > detected_at_server),
  check (
    not extensions.st_isempty(raw_polygon)
    and extensions.st_isvalid(raw_polygon)
    and extensions.st_srid(raw_polygon) = 4326
  )
);

create index loop_candidates_session_status_idx
  on public.loop_candidates(route_session_id, status, expires_at);
create index loop_candidates_player_detected_idx
  on public.loop_candidates(player_id, detected_at_server desc);
create index loop_candidates_polygon_gix
  on public.loop_candidates using gist(raw_polygon);

create table public.claim_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  world_id uuid not null references public.worlds(id) on delete restrict,
  route_session_id uuid not null references public.route_sessions(id) on delete cascade,
  loop_candidate_id uuid not null references public.loop_candidates(id) on delete cascade,
  operation_type text not null default 'close_loop'
    check (operation_type in ('close_loop', 'repaint', 'compensating_rollback')),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  last_accepted_point_sequence bigint not null check (last_accepted_point_sequence >= 1),
  selected_color_id text not null
    check (selected_color_id ~ '^(#[0-9A-F]{6}|[a-z][a-z0-9_]{2,31})$'),
  status text not null default 'RECEIVED'
    check (status in (
      'RECEIVED', 'AUTHENTICATING', 'SESSION_VALIDATION', 'ROUTE_VALIDATION',
      'GEOMETRY_RECONSTRUCTION', 'GEOMETRY_VALIDATION', 'CELL_CALCULATION',
      'RATE_LIMIT_CHECK', 'RISK_CHECK', 'WAITING_FOR_REGION_LOCK', 'PROCESSING',
      'COMMITTED', 'BROADCASTED', 'REJECTED_INVALID_ROUTE',
      'REJECTED_INVALID_GEOMETRY', 'REJECTED_LOW_ACCURACY',
      'REJECTED_IMPOSSIBLE_MOVEMENT', 'REJECTED_RATE_LIMIT',
      'REJECTED_STALE_SESSION', 'REJECTED_DUPLICATE',
      'REJECTED_RESTRICTED_REGION', 'FAILED_RETRYABLE', 'FAILED_FINAL'
    )),
  result_payload jsonb check (result_payload is null or jsonb_typeof(result_payload) = 'object'),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  correlation_id uuid not null default gen_random_uuid(),
  received_at timestamptz not null default now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  unique (user_id, operation_type, idempotency_key),
  foreign key (route_session_id, user_id, world_id)
    references public.route_sessions(id, player_id, world_id) on delete cascade,
  foreign key (loop_candidate_id, user_id, world_id, route_session_id)
    references public.loop_candidates(id, player_id, world_id, route_session_id)
    on delete cascade
);

create unique index claim_commands_candidate_committed_idx
  on public.claim_commands(loop_candidate_id)
  where status in ('COMMITTED', 'BROADCASTED');
create index claim_commands_user_received_idx
  on public.claim_commands(user_id, received_at desc);
create index claim_commands_pending_idx
  on public.claim_commands(status, received_at)
  where status not in ('COMMITTED', 'BROADCASTED', 'FAILED_FINAL')
    and status not like 'REJECTED_%';

create table public.claim_events (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique references public.claim_commands(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  world_id uuid not null references public.worlds(id) on delete restrict,
  route_session_id uuid not null references public.route_sessions(id) on delete cascade,
  loop_candidate_id uuid not null references public.loop_candidates(id) on delete cascade,
  world_version bigint not null check (world_version > 0),
  raw_polygon extensions.geometry(Polygon, 4326) not null,
  affected_region_ids uuid[] not null,
  region_versions jsonb not null check (jsonb_typeof(region_versions) = 'object'),
  newly_claimed_area_m2 numeric(18, 6) not null default 0 check (newly_claimed_area_m2 >= 0),
  captured_area_m2 numeric(18, 6) not null default 0 check (captured_area_m2 >= 0),
  already_owned_area_m2 numeric(18, 6) not null default 0 check (already_owned_area_m2 >= 0),
  restricted_area_m2 numeric(18, 6) not null default 0 check (restricted_area_m2 >= 0),
  repainted_area_m2 numeric(18, 6) not null default 0 check (repainted_area_m2 >= 0),
  total_loop_area_m2 numeric(18, 6) not null check (total_loop_area_m2 > 0),
  final_territory_area_m2 numeric(18, 6) not null default 0 check (final_territory_area_m2 >= 0),
  selected_color_id text not null
    check (selected_color_id ~ '^(#[0-9A-F]{6}|[a-z][a-z0-9_]{2,31})$'),
  lost_by_players jsonb not null default '{}'::jsonb
    check (jsonb_typeof(lost_by_players) = 'object'),
  risk_score numeric(6, 3) not null default 0 check (risk_score between 0 and 100),
  status text not null default 'committed'
    check (status in ('committed', 'voided', 'compensating_rollback')),
  compensates_event_id uuid references public.claim_events(id) on delete restrict,
  committed_at_server timestamptz not null default now(),
  unique (world_id, world_version),
  foreign key (route_session_id, user_id, world_id)
    references public.route_sessions(id, player_id, world_id) on delete cascade,
  foreign key (loop_candidate_id, user_id, world_id, route_session_id)
    references public.loop_candidates(id, player_id, world_id, route_session_id)
    on delete cascade,
  check (cardinality(affected_region_ids) between 1 and 256),
  check (
    not extensions.st_isempty(raw_polygon)
    and extensions.st_isvalid(raw_polygon)
    and extensions.st_srid(raw_polygon) = 4326
  )
);

create index claim_events_world_committed_idx
  on public.claim_events(world_id, world_version desc);
create index claim_events_user_committed_idx
  on public.claim_events(user_id, committed_at_server desc);
create index claim_events_polygon_gix
  on public.claim_events using gist(raw_polygon);

create table public.claim_cell_changes (
  claim_event_id uuid not null references public.claim_events(id) on delete cascade,
  world_id uuid not null,
  region_id uuid not null,
  cell_id text not null,
  previous_owner_id uuid references public.profiles(id) on delete set null,
  new_owner_id uuid references public.profiles(id) on delete set null,
  previous_paint_color_id text,
  new_paint_color_id text,
  operation text not null
    check (operation in ('claim', 'capture', 'repaint', 'rollback')),
  area_m2 numeric(18, 6) not null check (area_m2 > 0),
  previous_region_version bigint not null check (previous_region_version >= 0),
  region_version bigint not null check (region_version > previous_region_version),
  created_at timestamptz not null default now(),
  primary key (claim_event_id, cell_id),
  foreign key (world_id, cell_id)
    references public.territory_cells(world_id, cell_id) on delete restrict,
  foreign key (region_id, world_id)
    references public.world_regions(id, world_id) on delete restrict,
  check (
    previous_owner_id is distinct from new_owner_id
    or previous_paint_color_id is distinct from new_paint_color_id
  )
);

create index claim_cell_changes_cell_history_idx
  on public.claim_cell_changes(world_id, cell_id, region_version desc);
create index claim_cell_changes_region_version_idx
  on public.claim_cell_changes(world_id, region_id, region_version, cell_id);
create index claim_cell_changes_previous_owner_idx
  on public.claim_cell_changes(previous_owner_id, created_at desc)
  where previous_owner_id is not null;

alter table public.territory_cells
  add constraint territory_cells_last_claim_event_fk
  foreign key (last_claim_event_id) references public.claim_events(id) on delete set null;
alter table public.loop_candidates
  add constraint loop_candidates_claimed_event_fk
  foreign key (claimed_event_id) references public.claim_events(id) on delete set null;

create table public.player_scores (
  world_id uuid not null references public.worlds(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  current_owned_cell_count bigint not null default 0 check (current_owned_cell_count >= 0),
  current_territory_area_m2 numeric(20, 6) not null default 0
    check (current_territory_area_m2 >= 0),
  lifetime_claimed_area_m2 numeric(20, 6) not null default 0
    check (lifetime_claimed_area_m2 >= 0),
  lifetime_captured_area_m2 numeric(20, 6) not null default 0
    check (lifetime_captured_area_m2 >= 0),
  lifetime_lost_area_m2 numeric(20, 6) not null default 0
    check (lifetime_lost_area_m2 >= 0),
  lifetime_distance_m numeric(20, 3) not null default 0
    check (lifetime_distance_m >= 0),
  claim_count bigint not null default 0 check (claim_count >= 0),
  repaint_count bigint not null default 0 check (repaint_count >= 0),
  largest_claim_area_m2 numeric(18, 6) not null default 0
    check (largest_claim_area_m2 >= 0),
  score_version bigint not null default 0 check (score_version >= 0),
  updated_at timestamptz not null default now(),
  primary key (world_id, user_id)
);

create index player_scores_world_leaderboard_idx
  on public.player_scores(world_id, current_territory_area_m2 desc, user_id);

create trigger player_scores_set_updated_at
before update on public.player_scores
for each row execute function app_private.set_updated_at();

create table public.saved_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  world_id uuid not null references public.worlds(id) on delete restrict,
  route_session_id uuid references public.route_sessions(id) on delete set null,
  title text not null default 'Kaydedilen rota'
    check (char_length(trim(title)) between 1 and 80),
  raw_geometry extensions.geometry(LineString, 4326) not null,
  public_geometry extensions.geometry(LineString, 4326),
  distance_m numeric(18, 3) not null check (distance_m >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  visibility text not null default 'private'
    check (visibility in ('private', 'followers', 'public')),
  privacy_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, route_session_id),
  check (
    not extensions.st_isempty(raw_geometry)
    and extensions.st_isvalid(raw_geometry)
    and extensions.st_srid(raw_geometry) = 4326
  ),
  check (
    public_geometry is null
    or (
      not extensions.st_isempty(public_geometry)
      and extensions.st_isvalid(public_geometry)
      and extensions.st_srid(public_geometry) = 4326
    )
  ),
  check (visibility = 'private' or (public_geometry is not null and privacy_processed_at is not null))
);

create index saved_routes_user_created_idx
  on public.saved_routes(user_id, created_at desc);
create index saved_routes_public_created_idx
  on public.saved_routes(created_at desc)
  where visibility = 'public' and public_geometry is not null;
create index saved_routes_public_geometry_gix
  on public.saved_routes using gist(public_geometry)
  where public_geometry is not null;

create trigger saved_routes_set_updated_at
before update on public.saved_routes
for each row execute function app_private.set_updated_at();

alter table public.notifications
  add column world_id uuid references public.worlds(id) on delete cascade;
alter table public.notifications
  add column source_event_id uuid references public.claim_events(id) on delete cascade;

create unique index notifications_source_event_dedupe_idx
  on public.notifications(recipient_id, source_event_id, event_type)
  where source_event_id is not null;

create table public.realtime_outbox (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references public.worlds(id) on delete cascade,
  region_id uuid,
  recipient_id uuid references public.profiles(id) on delete cascade,
  claim_event_id uuid references public.claim_events(id) on delete cascade,
  topic text not null check (char_length(topic) between 10 and 180),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 220),
  previous_version bigint check (previous_version is null or previous_version >= 0),
  version bigint check (version is null or version > 0),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and not (payload ?| array[
      'latitude', 'longitude', 'gps', 'route', 'email', 'phone',
      'accessToken', 'refreshToken', 'deviceFingerprint', 'riskDetails'
    ])
  ),
  status text not null default 'pending'
    check (status in ('pending', 'published', 'dead_letter')),
  attempts integer not null default 0 check (attempts between 0 and 100),
  available_at timestamptz not null default now(),
  published_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  foreign key (region_id, world_id)
    references public.world_regions(id, world_id) on delete cascade,
  check (
    (region_id is not null and world_id is not null and recipient_id is null)
    or (recipient_id is not null and region_id is null)
  ),
  check ((previous_version is null) = (version is null))
);

create index realtime_outbox_dispatch_idx
  on public.realtime_outbox(available_at, created_at, id)
  where status = 'pending';
create index realtime_outbox_claim_event_idx
  on public.realtime_outbox(claim_event_id, created_at);

create table public.risk_events (
  id uuid primary key default gen_random_uuid(),
  world_id uuid references public.worlds(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  route_session_id uuid references public.route_sessions(id) on delete set null,
  claim_command_id uuid references public.claim_commands(id) on delete set null,
  risk_code text not null check (risk_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  severity text not null check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  score_delta numeric(6, 3) not null default 0 check (score_delta between 0 and 100),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'confirmed')),
  correlation_id uuid,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);

create index risk_events_open_severity_idx
  on public.risk_events(severity, created_at desc)
  where status = 'open';
create index risk_events_user_created_idx
  on public.risk_events(user_id, created_at desc)
  where user_id is not null;

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_type text not null check (actor_type in ('system', 'service', 'admin', 'user')),
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{2,95}$'),
  target_type text not null check (target_type ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  target_id text check (target_id is null or char_length(target_id) <= 180),
  world_id uuid references public.worlds(id) on delete set null,
  correlation_id uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  before_state jsonb check (before_state is null or jsonb_typeof(before_state) = 'object'),
  after_state jsonb check (after_state is null or jsonb_typeof(after_state) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_events_target_created_idx
  on public.audit_events(target_type, target_id, created_at desc);
create index audit_events_correlation_idx
  on public.audit_events(correlation_id)
  where correlation_id is not null;

create table public.restricted_regions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds(id) on delete cascade,
  region_id uuid,
  code text not null check (code ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  name text not null check (char_length(trim(name)) between 2 and 120),
  reason text not null check (char_length(trim(reason)) between 2 and 500),
  enforcement text not null default 'block'
    check (enforcement in ('block', 'ignore', 'review')),
  geom extensions.geometry(MultiPolygon, 4326) not null,
  active_from timestamptz not null default now(),
  active_until timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (world_id, code),
  foreign key (region_id, world_id)
    references public.world_regions(id, world_id) on delete cascade,
  check (active_until is null or active_until > active_from),
  check (
    not extensions.st_isempty(geom)
    and extensions.st_isvalid(geom)
    and extensions.st_srid(geom) = 4326
  )
);

create index restricted_regions_active_world_idx
  on public.restricted_regions(world_id, active_from, active_until);
create index restricted_regions_geom_gix
  on public.restricted_regions using gist(geom);

create trigger restricted_regions_set_updated_at
before update on public.restricted_regions
for each row execute function app_private.set_updated_at();

-- Central limits are data, not magic numbers in claim business logic.
alter table app_private.game_rules
  add column real_gps_proximity_threshold_m double precision not null default 12
    check (real_gps_proximity_threshold_m between 1 and 100),
  add column simulator_proximity_threshold_m double precision not null default 2
    check (simulator_proximity_threshold_m between 0.25 and 25),
  add column minimum_claim_cell_count integer not null default 3
    check (minimum_claim_cell_count between 1 and 1000),
  add column maximum_claim_cell_count integer not null default 10000
    check (maximum_claim_cell_count between 10 and 50000),
  add column maximum_batch_points integer not null default 128
    check (maximum_batch_points between 1 and 512),
  add column maximum_batch_bytes integer not null default 131072
    check (maximum_batch_bytes between 1024 and 262144),
  add column realtime_patch_cell_limit integer not null default 250
    check (realtime_patch_cell_limit between 1 and 2000),
  add column session_lease_seconds integer not null default 90
    check (session_lease_seconds between 30 and 900),
  add column offline_grace_seconds integer not null default 20
    check (offline_grace_seconds between 0 and 120),
  add column raw_point_retention_days integer not null default 30
    check (raw_point_retention_days between 1 and 90),
  add column maximum_competitive_risk_score numeric(6, 3) not null default 70
    check (maximum_competitive_risk_score between 1 and 100),
  add column claim_rate_window_seconds integer not null default 60
    check (claim_rate_window_seconds between 10 and 3600),
  add column claim_rate_max_commands integer not null default 12
    check (claim_rate_max_commands between 1 and 100),
  add column paint_cooldown_seconds integer not null default 5
    check (paint_cooldown_seconds between 0 and 300);

comment on table public.worlds is
  'mrap oyun dünyaları. Production ve simulation sandbox kesin olarak ayrıdır.';
comment on table public.world_regions is
  'Deterministik sırayla kilitlenen spatial partition ve monoton region version kaynağı.';
comment on table public.territory_cells is
  'Tek authoritative sahiplik kaynağı: her (world_id, cell_id) için en fazla bir owner ve bir güncel paint.';
comment on table public.route_point_batches is
  'Trusted server tarafından doğrulanan, süreli saklanan özel GPS batchleri; başka oyunculara veya Realtime kanalına çıkmaz.';
comment on table public.claim_events is
  'Başarılı authoritative claimlerin değişmez olay günlüğü. Current map bu tablodan değil territory_cells üzerinden okunur.';
comment on table public.realtime_outbox is
  'Claim transactionıyla atomik yazılan, private Broadcast publisher tarafından güvenle tekrar yayınlanabilen outbox.';
