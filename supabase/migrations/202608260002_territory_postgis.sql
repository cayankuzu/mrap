-- mrap production schema, phase 2: authoritative current territory, claim history and current paint.
-- Direct client writes are intentionally not exposed; the server-authoritative claim RPC/service is a separate rollout gate.

create sequence public.world_version_seq as bigint start with 1 increment by 1;

create table public.world_state (
  singleton boolean primary key default true check (singleton),
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.world_state(singleton, version) values (true, 0)
on conflict (singleton) do nothing;

create table app_private.game_rules (
  singleton boolean primary key default true check (singleton),
  minimum_claim_area_m2 double precision not null default 35 check (minimum_claim_area_m2 > 0),
  maximum_claim_area_m2 double precision not null default 50000000 check (maximum_claim_area_m2 > minimum_claim_area_m2),
  minimum_route_length_m double precision not null default 25 check (minimum_route_length_m > 0),
  maximum_polygon_points integer not null default 2000 check (maximum_polygon_points between 4 and 10000),
  maximum_route_points integer not null default 10000 check (maximum_route_points between 2 and 50000),
  maximum_gps_accuracy_m double precision not null default 65 check (maximum_gps_accuracy_m > 0),
  maximum_plausible_speed_mps double precision not null default 15 check (maximum_plausible_speed_mps > 0),
  updated_at timestamptz not null default now()
);

insert into app_private.game_rules(singleton) values (true)
on conflict (singleton) do nothing;

create table public.territory_current (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  chunk_key text not null default 'global' check (char_length(chunk_key) between 1 and 80),
  geom extensions.geometry(MultiPolygon, 4326) not null,
  area_m2 double precision not null default 0 check (area_m2 >= 0),
  world_version bigint not null default nextval('public.world_version_seq'),
  updated_at timestamptz not null default now(),
  primary key (owner_id, chunk_key),
  check (not extensions.st_isempty(geom)),
  check (extensions.st_isvalid(geom)),
  check (extensions.st_srid(geom) = 4326),
  check (extensions.st_coveredby(geom, extensions.st_makeenvelope(-180, -90, 180, 90, 4326)))
);

create index territory_current_geom_gix on public.territory_current using gist(geom);
create index territory_current_version_idx on public.territory_current(world_version);

create table public.claim_history (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  loop_signature text not null check (char_length(loop_signature) between 8 and 256),
  raw_polygon extensions.geometry(Polygon, 4326) not null,
  name text not null check (char_length(name) between 1 and 60),
  district text not null default '' check (char_length(district) <= 80),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  route_source text not null check (route_source in ('gps', 'simulation')),
  raw_area_m2 double precision not null check (raw_area_m2 > 0),
  newly_added_area_m2 double precision not null check (newly_added_area_m2 >= 0),
  overlap_area_m2 double precision not null check (overlap_area_m2 >= 0),
  total_area_after_m2 double precision not null check (total_area_after_m2 >= 0),
  distance_m double precision not null check (distance_m >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  committed_version bigint not null,
  map_snapshot_object_key text,
  created_at timestamptz not null default now(),
  unique (id, player_id),
  unique (player_id, idempotency_key),
  check (map_snapshot_object_key is null or map_snapshot_object_key like player_id::text || '/%'),
  check (extensions.st_isvalid(raw_polygon)),
  check (extensions.st_srid(raw_polygon) = 4326),
  check (extensions.st_coveredby(raw_polygon, extensions.st_makeenvelope(-180, -90, 180, 90, 4326)))
);

create index claim_history_player_created_idx on public.claim_history(player_id, created_at desc);
create index claim_history_geom_gix on public.claim_history using gist(raw_polygon);
create index claim_history_version_idx on public.claim_history(committed_version);

create table public.paint_current (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  chunk_key text not null default 'global' check (char_length(chunk_key) between 1 and 80),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  geom extensions.geometry(MultiPolygon, 4326) not null,
  world_version bigint not null default nextval('public.world_version_seq'),
  updated_at timestamptz not null default now(),
  primary key (owner_id, chunk_key, color),
  check (not extensions.st_isempty(geom)),
  check (extensions.st_isvalid(geom)),
  check (extensions.st_srid(geom) = 4326),
  check (extensions.st_coveredby(geom, extensions.st_makeenvelope(-180, -90, 180, 90, 4326)))
);

create index paint_current_geom_gix on public.paint_current using gist(geom);
create index paint_current_version_idx on public.paint_current(world_version);

create table public.world_change_log (
  version bigint primary key,
  entity text not null check (entity in ('territory', 'paint')),
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  owner_id uuid not null,
  chunk_key text not null,
  changed_bbox extensions.geometry(Polygon, 4326) not null,
  created_at timestamptz not null default now()
);

create index world_change_log_bbox_gix on public.world_change_log using gist(changed_bbox);
create index world_change_log_created_idx on public.world_change_log(created_at desc);

create or replace function app_private.sync_territory_current()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.geom := extensions.st_multi(new.geom);
  new.area_m2 := extensions.st_area(new.geom::extensions.geography);
  new.world_version := nextval('public.world_version_seq');
  new.updated_at := now();
  return new;
end;
$$;

create trigger territory_current_sync
before insert or update on public.territory_current
for each row execute function app_private.sync_territory_current();

create or replace function app_private.sync_paint_current()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.geom := extensions.st_multi(new.geom);
  new.world_version := nextval('public.world_version_seq');
  new.updated_at := now();
  return new;
end;
$$;

create trigger paint_current_sync
before insert or update on public.paint_current
for each row execute function app_private.sync_paint_current();

create or replace function app_private.record_world_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
begin
  if tg_op = 'DELETE' then
    v_version := nextval('public.world_version_seq');

    insert into public.world_change_log(version, entity, operation, owner_id, chunk_key, changed_bbox)
    values (
      v_version,
      case when tg_table_name = 'territory_current' then 'territory' else 'paint' end,
      tg_op,
      old.owner_id,
      old.chunk_key,
      extensions.st_envelope(old.geom)
    );

    update public.world_state
    set version = greatest(version, v_version), updated_at = now()
    where singleton = true;

    return old;
  end if;

  v_version := new.world_version;

  if tg_op = 'UPDATE' then
    insert into public.world_change_log(version, entity, operation, owner_id, chunk_key, changed_bbox)
    values (
      v_version,
      case when tg_table_name = 'territory_current' then 'territory' else 'paint' end,
      tg_op,
      new.owner_id,
      new.chunk_key,
      extensions.st_envelope(extensions.st_collect(old.geom, new.geom))
    );
  else
    insert into public.world_change_log(version, entity, operation, owner_id, chunk_key, changed_bbox)
    values (
      v_version,
      case when tg_table_name = 'territory_current' then 'territory' else 'paint' end,
      tg_op,
      new.owner_id,
      new.chunk_key,
      extensions.st_envelope(new.geom)
    );
  end if;

  update public.world_state
  set version = greatest(version, v_version), updated_at = now()
  where singleton = true;

  return new;
end;
$$;

create trigger territory_current_record_change
after insert or update or delete on public.territory_current
for each row execute function app_private.record_world_change();

create trigger paint_current_record_change
after insert or update or delete on public.paint_current
for each row execute function app_private.record_world_change();

comment on table public.territory_current is
  'Güncel sahiplik geometrisi. Claim geçmişi değildir; aynı fiziksel alan oyuncu skorunda yalnızca bir kez sayılır.';
comment on table public.claim_history is
  'Değişmez claim olayları ve idempotency kaydı. Haritada kalıcı üst üste katman olarak çizilmez.';
comment on table public.paint_current is
  'Güncel görsel boya sonucu. Sahiplik ve skor hesabından ayrıdır; son geçerli renk kazanır.';
