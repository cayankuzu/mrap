-- Production tracking is server-authoritative, but the original bootstrap kept
-- the shared world in draft mode. Open it only after validating the immutable
-- runtime contract used by the session and claim RPCs.
do $$
declare
  v_world public.worlds%rowtype;
begin
  select w.*
  into v_world
  from public.worlds w
  where w.id = '00000000-0000-4000-8000-000000000001'::uuid
    and w.slug = 'world-main'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PRODUCTION_WORLD_NOT_FOUND';
  end if;
  if v_world.environment <> 'production'
     or v_world.grid_resolution <> 22
     or v_world.region_resolution <> 14
     or v_world.supported_bounds is null then
    raise exception using errcode = '55000', message = 'PRODUCTION_WORLD_CONTRACT_MISMATCH';
  end if;

  update public.worlds
  set status = 'active',
      competitive_claims_enabled = true,
      allow_simulated_location = false
  where id = v_world.id;
end;
$$;
