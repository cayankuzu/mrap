-- mrap production schema, phase 13: runtime contract alignment.
--
-- This migration does not deploy the application adapter by itself. It makes
-- the hosted schema agree with the validated application contracts before the
-- adapter is allowed to connect: Unicode usernames, 13-100 age policy,
-- canonical world slugs/grid, authoritative claim-backed posts and a
-- transaction-safe distributed rate-limit primitive.

begin;

create or replace function app_private.normalize_username(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(translate(trim(p_value), 'Iİ', 'ıi'))
$$;

alter table public.profiles
  drop constraint if exists profiles_username_check;
alter table public.profiles
  add constraint profiles_username_unicode_check
  check (
    char_length(username::text) between 3 and 20
    and username::text ~ '^[[:alnum:]_]+$'
    and username::text = app_private.normalize_username(username::text)
  );

alter table public.profiles
  add column if not exists username_key text
  generated always as (app_private.normalize_username(username::text)) stored;
create unique index if not exists profiles_username_key_unique_idx
  on public.profiles(username_key);

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := app_private.normalize_username(new.raw_user_meta_data ->> 'username');
  v_display_name text := trim(new.raw_user_meta_data ->> 'display_name');
  v_country_code text := upper(trim(coalesce(new.raw_user_meta_data ->> 'country_code', new.raw_user_meta_data ->> 'countryCode')));
  v_city_id text := trim(coalesce(new.raw_user_meta_data ->> 'city_id', new.raw_user_meta_data ->> 'cityId'));
  v_birth_date date;
  v_color text := upper(coalesce(nullif(new.raw_user_meta_data ->> 'color', ''), '#0D8BFF'));
begin
  if v_username is null
     or char_length(v_username) not between 3 and 20
     or v_username !~ '^[[:alnum:]_]+$' then
    raise exception using errcode = '22023', message = 'INVALID_USERNAME';
  end if;
  if v_display_name is null or char_length(v_display_name) not between 2 and 60 then
    raise exception using errcode = '22023', message = 'INVALID_DISPLAY_NAME';
  end if;
  if not exists (
    select 1 from public.cities
    where id = v_city_id and country_code = v_country_code and is_active = true
  ) then
    raise exception using errcode = '22023', message = 'INVALID_LOCATION';
  end if;
  begin
    v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date;
  exception when others then
    raise exception using errcode = '22023', message = 'INVALID_BIRTH_DATE';
  end;
  if v_birth_date > (current_date - interval '13 years')::date
     or v_birth_date <= (current_date - interval '101 years')::date then
    raise exception using errcode = '22023', message = 'INVALID_AGE';
  end if;
  if v_color !~ '^#[0-9A-F]{6}$' then
    raise exception using errcode = '22023', message = 'INVALID_COLOR';
  end if;

  insert into public.profiles(id, username, display_name, country_code, city_id, color)
  values (new.id, v_username, v_display_name, v_country_code, v_city_id, v_color);

  insert into public.profile_private(user_id, birth_date, location_visibility)
  values (new.id, v_birth_date, 'private');

  return new;
end;
$$;

-- The HTTP contract uses stable world slugs. UUIDs remain internal relational
-- keys; no client is asked to guess them.
update public.worlds
set slug = case id
  when '00000000-0000-4000-8000-000000000001'::uuid then 'world-main'::extensions.citext
  when '00000000-0000-4000-8000-000000000002'::uuid then 'development-sandbox'::extensions.citext
  else slug
end
where id in (
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid
);

do $$
begin
  if exists (
    select 1
    from public.territory_cells tc
    join public.worlds w on w.id = tc.world_id
    where w.id in (
      '00000000-0000-4000-8000-000000000001'::uuid,
      '00000000-0000-4000-8000-000000000002'::uuid
    ) and w.grid_resolution <> 22
  ) then
    raise exception using
      errcode = '55000',
      message = 'GRID_RESOLUTION_MIGRATION_REQUIRES_EMPTY_WORLD';
  end if;
end;
$$;

update public.worlds
set grid_resolution = 22,
    grid_definition_version = greatest(grid_definition_version, 2),
    updated_at = now()
where id in (
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid
);

-- Posts created before the authoritative grid rollout keep their immutable
-- legacy claim reference. New posts can reference claim_events directly.
alter table public.claim_events
  add constraint claim_events_id_user_unique unique (id, user_id);
alter table public.posts
  alter column claim_id drop not null,
  add column if not exists claim_event_id uuid;
alter table public.posts
  add constraint posts_claim_event_author_fk
  foreign key (claim_event_id, author_id)
  references public.claim_events(id, user_id)
  on delete cascade;
alter table public.posts
  add constraint posts_exactly_one_claim_source_check
  check (num_nonnulls(claim_id, claim_event_id) = 1);
create index if not exists posts_claim_event_idx
  on public.posts(claim_event_id)
  where claim_event_id is not null;

create table if not exists app_private.api_rate_limits (
  scope_hash text primary key check (scope_hash ~ '^[0-9a-f]{64}$'),
  hit_count integer not null check (hit_count >= 1),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists api_rate_limits_reset_idx
  on app_private.api_rate_limits(reset_at);

create or replace function app_private.consume_rate_limit(
  p_scope_hash text,
  p_maximum_hits integer,
  p_window_ms integer
)
returns table(allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row app_private.api_rate_limits%rowtype;
begin
  if p_scope_hash !~ '^[0-9a-f]{64}$'
     or p_maximum_hits < 1
     or p_maximum_hits > 100000
     or p_window_ms < 1000
     or p_window_ms > 86400000 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT_INPUT';
  end if;

  insert into app_private.api_rate_limits(scope_hash, hit_count, reset_at, updated_at)
  values (
    p_scope_hash,
    1,
    v_now + make_interval(secs => p_window_ms::double precision / 1000.0),
    v_now
  )
  on conflict (scope_hash) do update
  set hit_count = case
        when app_private.api_rate_limits.reset_at <= v_now then 1
        else app_private.api_rate_limits.hit_count + 1
      end,
      reset_at = case
        when app_private.api_rate_limits.reset_at <= v_now
          then v_now + make_interval(secs => p_window_ms::double precision / 1000.0)
        else app_private.api_rate_limits.reset_at
      end,
      updated_at = v_now
  returning * into v_row;

  allowed := v_row.hit_count <= p_maximum_hits;
  remaining := greatest(0, p_maximum_hits - v_row.hit_count);
  retry_after_seconds := greatest(0, ceil(extract(epoch from (v_row.reset_at - v_now)))::integer);
  return next;
end;
$$;

revoke all on table app_private.api_rate_limits from public, anon, authenticated;
grant all on table app_private.api_rate_limits to service_role;
revoke all on function app_private.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function app_private.consume_rate_limit(text, integer, integer) to service_role;

create or replace function app_private.runtime_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', 13,
    'productionWorldSlug', (
      select w.slug::text from public.worlds w
      where w.id = '00000000-0000-4000-8000-000000000001'::uuid
    ),
    'gridResolution', (
      select w.grid_resolution from public.worlds w
      where w.id = '00000000-0000-4000-8000-000000000001'::uuid
    ),
    'postClaimEventReady', exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'posts' and c.column_name = 'claim_event_id'
    ),
    'distributedRateLimitReady', to_regclass('app_private.api_rate_limits') is not null
  )
$$;

revoke all on function app_private.runtime_contract() from public, anon, authenticated;
grant execute on function app_private.runtime_contract() to service_role;

comment on function app_private.runtime_contract() is
  'Trusted deployment/readiness probe. Secret veya kullanıcı verisi döndürmez.';

commit;
