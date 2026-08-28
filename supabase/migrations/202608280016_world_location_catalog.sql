-- mrap production schema, phase 16: on-demand normalized world locations.
--
-- The application validates country/city pairs against its server-only world
-- catalogue, then a trusted service-role call upserts the selected normalized
-- row before Auth creates or profile updates reference it. The FK remains in
-- place, so arbitrary direct Auth metadata cannot bypass location integrity.

begin;

alter table public.cities
  drop constraint if exists cities_id_check;
alter table public.cities
  add constraint cities_id_check check (
    id ~ '^[a-z]{2}-[a-z0-9-]{2,80}$'
    or id ~ '^csc:[A-Z]{2}:[A-Za-z0-9_-]{1,16}:[0-9]{1,12}$'
  );

alter function app_private.runtime_contract() rename to runtime_contract_v15;

create function app_private.runtime_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.runtime_contract_v15()
    || jsonb_build_object(
      'schemaVersion', 16,
      'worldLocationsOnDemandReady', exists (
        select 1
        from pg_catalog.pg_constraint c
        join pg_catalog.pg_class t on t.oid = c.conrelid
        join pg_catalog.pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public'
          and t.relname = 'cities'
          and c.conname = 'cities_id_check'
          and pg_catalog.pg_get_constraintdef(c.oid) like '%csc:%'
      )
    )
$$;

revoke all on function app_private.runtime_contract_v15() from public, anon, authenticated;
revoke all on function app_private.runtime_contract() from public, anon, authenticated;
grant execute on function app_private.runtime_contract() to service_role;

comment on function app_private.runtime_contract() is
  'Trusted deployment/readiness probe including on-demand normalized world location support.';

commit;
