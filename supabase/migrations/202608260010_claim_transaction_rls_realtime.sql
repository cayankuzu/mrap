-- mrap production schema, phase 9: least-privilege access, atomic claims and
-- reliable private Realtime publishing.

alter table public.worlds enable row level security;
alter table public.world_regions enable row level security;
alter table public.territory_cells enable row level security;
alter table public.route_point_batches enable row level security;
alter table public.loop_candidates enable row level security;
alter table public.claim_commands enable row level security;
alter table public.claim_events enable row level security;
alter table public.claim_cell_changes enable row level security;
alter table public.player_scores enable row level security;
alter table public.saved_routes enable row level security;
alter table public.realtime_outbox enable row level security;
alter table public.risk_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.restricted_regions enable row level security;

revoke all on table
  public.worlds,
  public.world_regions,
  public.territory_cells,
  public.route_point_batches,
  public.loop_candidates,
  public.claim_commands,
  public.claim_events,
  public.claim_cell_changes,
  public.player_scores,
  public.saved_routes,
  public.realtime_outbox,
  public.risk_events,
  public.audit_events,
  public.restricted_regions
from anon, authenticated;

grant select on table
  public.worlds,
  public.world_regions,
  public.territory_cells,
  public.route_point_batches,
  public.loop_candidates,
  public.claim_commands,
  public.claim_events,
  public.player_scores,
  public.saved_routes,
  public.restricted_regions
to authenticated;

grant all on table
  public.worlds,
  public.world_regions,
  public.territory_cells,
  public.route_point_batches,
  public.loop_candidates,
  public.claim_commands,
  public.claim_events,
  public.claim_cell_changes,
  public.player_scores,
  public.saved_routes,
  public.realtime_outbox,
  public.risk_events,
  public.audit_events,
  public.restricted_regions
to service_role;

grant usage, select on all sequences in schema public to service_role;

create policy worlds_read_authenticated
on public.worlds for select
to authenticated
using (status in ('active', 'maintenance'));

create policy world_regions_read_authenticated
on public.world_regions for select
to authenticated
using (
  exists (
    select 1
    from public.worlds w
    where w.id = world_regions.world_id
      and w.status in ('active', 'maintenance')
  )
);

create policy territory_cells_read_authenticated
on public.territory_cells for select
to authenticated
using (
  exists (
    select 1
    from public.worlds w
    where w.id = territory_cells.world_id
      and w.status in ('active', 'maintenance')
  )
);

create policy route_point_batches_read_self
on public.route_point_batches for select
to authenticated
using ((select auth.uid()) = player_id);

create policy loop_candidates_read_self
on public.loop_candidates for select
to authenticated
using ((select auth.uid()) = player_id);

create policy claim_commands_read_self
on public.claim_commands for select
to authenticated
using ((select auth.uid()) = user_id);

create policy claim_events_read_self
on public.claim_events for select
to authenticated
using ((select auth.uid()) = user_id);

create policy player_scores_read_authenticated
on public.player_scores for select
to authenticated
using (
  exists (
    select 1
    from public.worlds w
    where w.id = player_scores.world_id
      and w.status in ('active', 'maintenance')
  )
);

create policy saved_routes_read_self
on public.saved_routes for select
to authenticated
using ((select auth.uid()) = user_id);

create policy restricted_regions_read_authenticated
on public.restricted_regions for select
to authenticated
using (
  active_from <= now()
  and (active_until is null or active_until > now())
  and exists (
    select 1
    from public.worlds w
    where w.id = restricted_regions.world_id
      and w.status in ('active', 'maintenance')
  )
);

-- Version fields may stay equal during metadata-only updates but can never move
-- backwards, even during a trusted maintenance write.
create or replace function app_private.enforce_world_version_monotonic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.current_version < old.current_version then
    raise exception using errcode = '23514', message = 'WORLD_VERSION_REGRESSION';
  end if;
  return new;
end;
$$;

create or replace function app_private.enforce_region_version_monotonic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version < old.version then
    raise exception using errcode = '23514', message = 'REGION_VERSION_REGRESSION';
  end if;
  return new;
end;
$$;

create or replace function app_private.enforce_cell_versions_monotonic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ownership_version < old.ownership_version
     or new.paint_version < old.paint_version then
    raise exception using errcode = '23514', message = 'CELL_VERSION_REGRESSION';
  end if;
  return new;
end;
$$;

create or replace function app_private.enforce_score_version_monotonic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.score_version < old.score_version then
    raise exception using errcode = '23514', message = 'SCORE_VERSION_REGRESSION';
  end if;
  return new;
end;
$$;

create trigger worlds_enforce_version_monotonic
before update on public.worlds
for each row execute function app_private.enforce_world_version_monotonic();
create trigger world_regions_enforce_version_monotonic
before update on public.world_regions
for each row execute function app_private.enforce_region_version_monotonic();
create trigger territory_cells_enforce_versions_monotonic
before update on public.territory_cells
for each row execute function app_private.enforce_cell_versions_monotonic();
create trigger player_scores_enforce_version_monotonic
before update on public.player_scores
for each row execute function app_private.enforce_score_version_monotonic();

-- Claim history is append-only. Legal account deletion may purge it only inside
-- the dedicated service-role account deletion transaction through a local GUC.
create or replace function app_private.guard_immutable_claim_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('mrap.allow_claim_history_purge', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    if tg_op = 'UPDATE' then
      return new;
    end if;
  end if;
  raise exception using errcode = '55000', message = 'CLAIM_HISTORY_IS_IMMUTABLE';
end;
$$;

create trigger claim_events_immutable
before update or delete on public.claim_events
for each row execute function app_private.guard_immutable_claim_history();
create trigger claim_cell_changes_immutable
before update or delete on public.claim_cell_changes
for each row execute function app_private.guard_immutable_claim_history();

revoke all on function app_private.normalize_territory_cell()
  from public, anon, authenticated;
revoke all on function app_private.enforce_world_version_monotonic()
  from public, anon, authenticated;
revoke all on function app_private.enforce_region_version_monotonic()
  from public, anon, authenticated;
revoke all on function app_private.enforce_cell_versions_monotonic()
  from public, anon, authenticated;
revoke all on function app_private.enforce_score_version_monotonic()
  from public, anon, authenticated;
revoke all on function app_private.guard_immutable_claim_history()
  from public, anon, authenticated;

-- The phase-4 global topic is retired. Authoritative changes are delivered by
-- region-scoped private channels from the transactional outbox.
drop trigger if exists world_change_log_broadcast on public.world_change_log;
drop policy if exists mrap_world_receive on realtime.messages;
drop policy if exists mrap_region_receive on realtime.messages;
drop policy if exists mrap_user_private_receive on realtime.messages;

create policy mrap_region_receive
on realtime.messages for select
to authenticated
using (
  exists (
    select 1
    from public.world_regions wr
    join public.worlds w on w.id = wr.world_id
    where w.status in ('active', 'maintenance')
      and wr.status <> 'disabled'
      and (select realtime.topic()) =
        'world:' || w.id::text || ':region:' || wr.id::text
  )
);

create policy mrap_user_private_receive
on realtime.messages for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select realtime.topic()) =
    'user:' || (select auth.uid())::text || ':private'
);

-- No INSERT policy is granted to anon/authenticated. Only this service-role
-- function can turn outbox rows into private Broadcast messages.
create or replace function app_private.publish_realtime_outbox_batch(
  p_limit integer default 100
)
returns table(published_count integer, failed_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.realtime_outbox%rowtype;
  v_published integer := 0;
  v_failed integer := 0;
  v_error text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'INVALID_OUTBOX_BATCH_LIMIT';
  end if;

  for v_row in
    select o.*
    from public.realtime_outbox o
    where o.status = 'pending'
      and o.available_at <= now()
    order by o.available_at, o.created_at, o.id
    for update skip locked
    limit p_limit
  loop
    begin
      perform realtime.send(v_row.payload, v_row.event_type, v_row.topic, true);

      update public.realtime_outbox
      set
        status = 'published',
        attempts = attempts + 1,
        published_at = now(),
        last_error = null
      where id = v_row.id;

      v_published := v_published + 1;
    exception when others then
      get stacked diagnostics v_error = message_text;

      update public.realtime_outbox
      set
        attempts = attempts + 1,
        status = case when attempts + 1 >= 10 then 'dead_letter' else 'pending' end,
        available_at = now()
          + (least(300, power(2, least(attempts + 1, 8))::integer) * interval '1 second'),
        last_error = left(v_error, 500)
      where id = v_row.id;

      v_failed := v_failed + 1;
    end;
  end loop;

  update public.claim_commands cc
  set status = 'BROADCASTED'
  where cc.status = 'COMMITTED'
    and exists (
      select 1 from public.claim_events ce where ce.command_id = cc.id
    )
    and exists (
      select 1
      from public.claim_events ce
      join public.realtime_outbox o on o.claim_event_id = ce.id
      where ce.command_id = cc.id
    )
    and not exists (
      select 1
      from public.claim_events ce
      join public.realtime_outbox o on o.claim_event_id = ce.id
      where ce.command_id = cc.id
        and o.status <> 'published'
    );

  return query select v_published, v_failed;
end;
$$;

revoke all on function app_private.publish_realtime_outbox_batch(integer)
  from public, anon, authenticated;
grant execute on function app_private.publish_realtime_outbox_batch(integer)
  to service_role;

-- Atomic, idempotent, server-only close-loop transaction. The function accepts
-- no polygon, owner, score, cell list or client timestamp. Those inputs were
-- previously produced by a trusted route validator and are reloaded from the
-- loop_candidates row while the authoritative world/regions/cells are locked.
create or replace function app_private.execute_claim_command(
  p_authoritative_user_id uuid,
  p_route_session_id uuid,
  p_loop_candidate_id uuid,
  p_last_accepted_point_sequence bigint,
  p_selected_color_id text,
  p_idempotency_key text,
  p_payload_hash text,
  p_correlation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.route_sessions%rowtype;
  v_candidate public.loop_candidates%rowtype;
  v_world public.worlds%rowtype;
  v_command public.claim_commands%rowtype;
  v_rules app_private.game_rules%rowtype;
  v_inserted integer := 0;
  v_color text;
  v_correlation_id uuid := coalesce(p_correlation_id, gen_random_uuid());
  v_cell_count bigint := 0;
  v_distinct_cell_count bigint := 0;
  v_covered_sequence_count bigint := 0;
  v_region_ids uuid[];
  v_changed_region_ids uuid[];
  v_candidate_region_ids uuid[];
  v_world_version bigint;
  v_event_id uuid := gen_random_uuid();
  v_newly_claimed numeric(18, 6) := 0;
  v_captured numeric(18, 6) := 0;
  v_already_owned numeric(18, 6) := 0;
  v_repainted numeric(18, 6) := 0;
  v_total_loop numeric(18, 6) := 0;
  v_current_before numeric(20, 6) := 0;
  v_final_territory numeric(20, 6) := 0;
  v_restricted numeric(18, 6) := 0;
  v_lost_by_players jsonb := '{}'::jsonb;
  v_captured_from jsonb := '[]'::jsonb;
  v_region_versions jsonb := '{}'::jsonb;
  v_result jsonb;
  v_error_code text;
  v_command_status text;
begin
  if p_authoritative_user_id is null
     or p_route_session_id is null
     or p_loop_candidate_id is null then
    raise exception using errcode = '22023', message = 'INVALID_COMMAND_IDENTIFIERS';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 16 and 128
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  if p_payload_hash is null or lower(p_payload_hash) !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD_HASH';
  end if;

  if p_last_accepted_point_sequence is null or p_last_accepted_point_sequence < 1 then
    raise exception using errcode = '22023', message = 'INVALID_POINT_SEQUENCE';
  end if;

  v_color := case
    when p_selected_color_id like '#%' then upper(p_selected_color_id)
    else lower(p_selected_color_id)
  end;

  if v_color !~ '^(#[0-9A-F]{6}|[a-z][a-z0-9_]{2,31})$' then
    raise exception using errcode = '22023', message = 'INVALID_COLOR_ID';
  end if;

  select rs.* into v_session
  from public.route_sessions rs
  where rs.id = p_route_session_id;

  if not found then
    insert into public.risk_events(
      user_id, risk_code, severity, score_delta, evidence, correlation_id
    ) values (
      p_authoritative_user_id,
      'FOREIGN_SESSION_REFERENCE',
      'HIGH',
      20,
      jsonb_build_object('routeSessionFound', false),
      v_correlation_id
    );
    return jsonb_build_object('status', 'rejected', 'errorCode', 'INVALID_ROUTE_SESSION');
  end if;

  select lc.* into v_candidate
  from public.loop_candidates lc
  where lc.id = p_loop_candidate_id;

  if not found then
    insert into public.risk_events(
      world_id, user_id, route_session_id, risk_code, severity,
      score_delta, evidence, correlation_id
    ) values (
      v_session.world_id,
      p_authoritative_user_id,
      v_session.id,
      'FOREIGN_CANDIDATE_REFERENCE',
      'HIGH',
      20,
      jsonb_build_object('loopCandidateFound', false),
      v_correlation_id
    );
    return jsonb_build_object('status', 'rejected', 'errorCode', 'INVALID_LOOP_CANDIDATE');
  end if;

  if v_session.player_id <> p_authoritative_user_id
     or v_candidate.player_id <> p_authoritative_user_id
     or v_candidate.route_session_id <> v_session.id
     or v_candidate.world_id <> v_session.world_id then
    insert into public.risk_events(
      world_id, user_id, route_session_id, risk_code, severity,
      score_delta, evidence, correlation_id
    ) values (
      v_session.world_id,
      p_authoritative_user_id,
      v_session.id,
      'FOREIGN_SESSION_OR_CANDIDATE',
      'HIGH',
      25,
      jsonb_build_object('ownershipCheck', false),
      v_correlation_id
    );
    insert into public.audit_events(
      actor_user_id, actor_type, action, target_type, target_id,
      world_id, correlation_id, reason
    ) values (
      p_authoritative_user_id,
      'user',
      'claim.foreign_reference_rejected',
      'route_session',
      v_session.id::text,
      v_session.world_id,
      v_correlation_id,
      'Session/candidate kullanıcı veya dünya eşleşmesi başarısız.'
    );
    return jsonb_build_object(
      'status', 'rejected',
      'errorCode', 'FOREIGN_SESSION_OR_CANDIDATE'
    );
  end if;

  insert into public.claim_commands(
    user_id,
    world_id,
    route_session_id,
    loop_candidate_id,
    operation_type,
    idempotency_key,
    payload_hash,
    last_accepted_point_sequence,
    selected_color_id,
    status,
    correlation_id
  ) values (
    p_authoritative_user_id,
    v_session.world_id,
    p_route_session_id,
    p_loop_candidate_id,
    'close_loop',
    p_idempotency_key,
    lower(p_payload_hash),
    p_last_accepted_point_sequence,
    v_color,
    'RECEIVED',
    v_correlation_id
  )
  on conflict (user_id, operation_type, idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;

  select cc.* into v_command
  from public.claim_commands cc
  where cc.user_id = p_authoritative_user_id
    and cc.operation_type = 'close_loop'
    and cc.idempotency_key = p_idempotency_key
  for update;

  if v_inserted = 0 then
    if v_command.payload_hash <> lower(p_payload_hash)
       or v_command.route_session_id <> p_route_session_id
       or v_command.loop_candidate_id <> p_loop_candidate_id
       or v_command.last_accepted_point_sequence <> p_last_accepted_point_sequence
       or v_command.selected_color_id <> v_color then
      insert into public.risk_events(
        world_id, user_id, route_session_id, claim_command_id, risk_code,
        severity, score_delta, evidence, correlation_id
      ) values (
        v_command.world_id,
        p_authoritative_user_id,
        p_route_session_id,
        v_command.id,
        'IDEMPOTENCY_PAYLOAD_MISMATCH',
        'HIGH',
        25,
        jsonb_build_object('operationType', 'close_loop'),
        v_correlation_id
      );

      insert into public.audit_events(
        actor_user_id, actor_type, action, target_type, target_id,
        world_id, correlation_id, reason, metadata
      ) values (
        p_authoritative_user_id,
        'user',
        'claim.idempotency_mismatch',
        'claim_command',
        v_command.id::text,
        v_command.world_id,
        v_correlation_id,
        'Aynı idempotency anahtarı farklı payload ile gönderildi.',
        jsonb_build_object('operationType', 'close_loop')
      );

      return jsonb_build_object(
        'status', 'rejected',
        'errorCode', 'IDEMPOTENCY_PAYLOAD_MISMATCH',
        'commandId', v_command.id
      );
    end if;

    return coalesce(
      v_command.result_payload,
      jsonb_build_object(
        'status', lower(v_command.status),
        'commandId', v_command.id,
        'processing', v_command.status not in ('COMMITTED', 'BROADCASTED', 'FAILED_FINAL')
      )
    );
  end if;

  begin
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

    update public.claim_commands
    set status = 'SESSION_VALIDATION', processing_started_at = now()
    where id = v_command.id;

    if v_session.player_id <> p_authoritative_user_id
       or v_candidate.player_id <> p_authoritative_user_id
       or v_candidate.route_session_id <> v_session.id
       or v_candidate.world_id <> v_session.world_id then
      raise exception 'FOREIGN_SESSION_OR_CANDIDATE';
    end if;

    if v_session.session_kind <> 'competitive'
       or v_session.status not in ('active', 'paused', 'closing')
       or v_session.lease_expires_at is null
       or v_session.lease_expires_at <= now() then
      raise exception 'STALE_ROUTE_SESSION';
    end if;

    if v_world.environment = 'production'
       and v_session.location_mode <> 'real_gps' then
      raise exception 'SIMULATION_NOT_ALLOWED';
    end if;

    if v_session.risk_score >= v_rules.maximum_competitive_risk_score then
      raise exception 'RISK_SCORE_TOO_HIGH';
    end if;

    if v_candidate.status not in ('available', 'accepted')
       or v_candidate.expires_at <= now() then
      raise exception 'STALE_LOOP_CANDIDATE';
    end if;

    if p_last_accepted_point_sequence <> v_session.last_accepted_sequence
       or v_candidate.end_sequence > p_last_accepted_point_sequence then
      raise exception 'STALE_POINT_SEQUENCE';
    end if;

    update public.claim_commands
    set status = 'RATE_LIMIT_CHECK'
    where id = v_command.id;

    if (
      select count(*)
      from public.claim_commands cc
      where cc.user_id = p_authoritative_user_id
        and cc.operation_type in ('close_loop', 'repaint')
        and cc.received_at >= now() - make_interval(secs => v_rules.claim_rate_window_seconds)
    ) > v_rules.claim_rate_max_commands then
      raise exception 'CLAIM_RATE_LIMITED';
    end if;

    update public.claim_commands
    set status = 'GEOMETRY_VALIDATION'
    where id = v_command.id;

    if not extensions.st_isvalid(v_candidate.raw_polygon)
       or extensions.st_isempty(v_candidate.raw_polygon)
       or extensions.st_geometrytype(v_candidate.raw_polygon) <> 'ST_Polygon'
       or extensions.st_npoints(v_candidate.raw_polygon) > v_rules.maximum_polygon_points
       or v_candidate.estimated_area_m2 < v_rules.minimum_claim_area_m2
       or v_candidate.estimated_area_m2 > v_rules.maximum_claim_area_m2
       or v_candidate.route_length_m < v_rules.minimum_route_length_m
       or (
         v_world.supported_bounds is not null
         and not extensions.st_coveredby(v_candidate.raw_polygon, v_world.supported_bounds)
       ) then
      raise exception 'INVALID_CLAIM_GEOMETRY';
    end if;

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

    if v_covered_sequence_count <
       (v_candidate.end_sequence - v_candidate.start_sequence + 1) then
      raise exception 'ROUTE_SEQUENCE_GAP';
    end if;

    update public.claim_commands
    set status = 'CELL_CALCULATION'
    where id = v_command.id;

    select count(*), count(distinct u.cell_id)
    into v_cell_count, v_distinct_cell_count
    from unnest(v_candidate.target_cell_ids) as u(cell_id);

    if v_cell_count < v_rules.minimum_claim_cell_count
       or v_cell_count > v_rules.maximum_claim_cell_count
       or v_cell_count <> v_distinct_cell_count
       or exists (
         select 1 from unnest(v_candidate.target_cell_ids) as u(cell_id)
         where u.cell_id is null
       ) then
      raise exception 'INVALID_TARGET_CELL_SET';
    end if;

    select
      count(*),
      array_agg(distinct tc.region_id order by tc.region_id)
    into v_distinct_cell_count, v_region_ids
    from public.territory_cells tc
    where tc.world_id = v_world.id
      and tc.cell_id = any(v_candidate.target_cell_ids);

    if v_distinct_cell_count <> v_cell_count or v_region_ids is null then
      raise exception 'UNMATERIALIZED_TARGET_CELL';
    end if;

    select array_agg(distinct u.region_id order by u.region_id)
    into v_candidate_region_ids
    from unnest(v_candidate.affected_region_ids) as u(region_id);

    if v_candidate_region_ids is distinct from v_region_ids then
      raise exception 'REGION_SET_MISMATCH';
    end if;

    if exists (
      select 1
      from public.world_regions wr
      where wr.id = any(v_region_ids)
        and (wr.world_id <> v_world.id or wr.status <> 'active')
    ) then
      raise exception 'REGION_NOT_WRITABLE';
    end if;

    select coalesce(sum(tc.area_m2), 0)
    into v_restricted
    from public.territory_cells tc
    where tc.world_id = v_world.id
      and tc.cell_id = any(v_candidate.target_cell_ids)
      and exists (
        select 1
        from public.restricted_regions rr
        where rr.world_id = tc.world_id
          and rr.enforcement = 'block'
          and rr.active_from <= now()
          and (rr.active_until is null or rr.active_until > now())
          and extensions.st_covers(rr.geom, tc.center_point)
      );

    if v_restricted > 0 then
      raise exception 'RESTRICTED_REGION';
    end if;

    update public.claim_commands
    set status = 'WAITING_FOR_REGION_LOCK'
    where id = v_command.id;

    perform 1
    from public.world_regions wr
    where wr.world_id = v_world.id
      and wr.id = any(v_region_ids)
    order by wr.id
    for update;

    perform 1
    from public.territory_cells tc
    where tc.world_id = v_world.id
      and tc.cell_id = any(v_candidate.target_cell_ids)
    order by tc.region_id, tc.cell_id
    for update;

    update public.claim_commands
    set status = 'PROCESSING'
    where id = v_command.id;

    select
      coalesce(sum(tc.area_m2) filter (where tc.owner_id is null), 0),
      coalesce(sum(tc.area_m2) filter (
        where tc.owner_id is not null and tc.owner_id <> p_authoritative_user_id
      ), 0),
      coalesce(sum(tc.area_m2) filter (
        where tc.owner_id = p_authoritative_user_id
      ), 0),
      coalesce(sum(tc.area_m2) filter (
        where tc.owner_id = p_authoritative_user_id
          and tc.paint_color_id is distinct from v_color
      ), 0),
      coalesce(sum(tc.area_m2), 0)
    into
      v_newly_claimed,
      v_captured,
      v_already_owned,
      v_repainted,
      v_total_loop
    from public.territory_cells tc
    where tc.world_id = v_world.id
      and tc.cell_id = any(v_candidate.target_cell_ids);

    select coalesce(sum(tc.area_m2), 0)
    into v_current_before
    from public.territory_cells tc
    where tc.world_id = v_world.id
      and tc.owner_id = p_authoritative_user_id;

    v_final_territory := v_current_before + v_newly_claimed + v_captured;

    select coalesce(jsonb_object_agg(loss.owner_id::text, loss.area_m2), '{}'::jsonb)
    into v_lost_by_players
    from (
      select tc.owner_id, sum(tc.area_m2) as area_m2
      from public.territory_cells tc
      where tc.world_id = v_world.id
        and tc.cell_id = any(v_candidate.target_cell_ids)
        and tc.owner_id is not null
        and tc.owner_id <> p_authoritative_user_id
      group by tc.owner_id
    ) loss;

    select coalesce(
      jsonb_agg(
        jsonb_build_object('userId', e.key, 'areaM2', e.value)
        order by e.key
      ),
      '[]'::jsonb
    )
    into v_captured_from
    from jsonb_each(v_lost_by_players) e;

    select array_agg(distinct tc.region_id order by tc.region_id)
    into v_changed_region_ids
    from public.territory_cells tc
    where tc.world_id = v_world.id
      and tc.cell_id = any(v_candidate.target_cell_ids)
      and (
        tc.owner_id is distinct from p_authoritative_user_id
        or tc.paint_color_id is distinct from v_color
      );

    -- An identical self-owned repaint is a true idempotent no-op: it creates
    -- no claim event, score delta, notification, version or outbox spam.
    if v_newly_claimed = 0 and v_captured = 0 and v_repainted = 0 then
      v_result := jsonb_build_object(
        'status', 'accepted',
        'noOp', true,
        'commandId', v_command.id,
        'newlyClaimedAreaM2', 0,
        'capturedFromOthersAreaM2', 0,
        'alreadyOwnedAreaM2', v_already_owned,
        'restrictedAreaM2', 0,
        'totalLoopAreaM2', v_total_loop,
        'finalTerritoryAreaM2', v_current_before,
        'affectedRegionVersions', '{}'::jsonb,
        'capturedFrom', '[]'::jsonb
      );

      update public.loop_candidates
      set status = 'claimed'
      where id = v_candidate.id;

      update public.claim_commands
      set status = 'COMMITTED', result_payload = v_result, completed_at = now()
      where id = v_command.id;

      return v_result;
    end if;

    update public.worlds
    set current_version = current_version + 1
    where id = v_world.id
    returning current_version into v_world_version;

    update public.world_regions wr
    set version = wr.version + 1
    where wr.world_id = v_world.id
      and wr.id = any(v_changed_region_ids);

    select coalesce(
      jsonb_object_agg(wr.id::text, wr.version order by wr.id::text),
      '{}'::jsonb
    )
    into v_region_versions
    from public.world_regions wr
    where wr.world_id = v_world.id
      and wr.id = any(v_changed_region_ids);

    insert into public.claim_events(
      id,
      command_id,
      user_id,
      world_id,
      route_session_id,
      loop_candidate_id,
      world_version,
      raw_polygon,
      affected_region_ids,
      region_versions,
      newly_claimed_area_m2,
      captured_area_m2,
      already_owned_area_m2,
      restricted_area_m2,
      repainted_area_m2,
      total_loop_area_m2,
      final_territory_area_m2,
      selected_color_id,
      lost_by_players,
      risk_score,
      status
    ) values (
      v_event_id,
      v_command.id,
      p_authoritative_user_id,
      v_world.id,
      v_session.id,
      v_candidate.id,
      v_world_version,
      v_candidate.raw_polygon,
      v_changed_region_ids,
      v_region_versions,
      v_newly_claimed,
      v_captured,
      v_already_owned,
      0,
      v_repainted,
      v_total_loop,
      v_final_territory,
      v_color,
      v_lost_by_players,
      v_session.risk_score,
      'committed'
    );

    insert into public.claim_cell_changes(
      claim_event_id,
      world_id,
      region_id,
      cell_id,
      previous_owner_id,
      new_owner_id,
      previous_paint_color_id,
      new_paint_color_id,
      operation,
      area_m2,
      previous_region_version,
      region_version
    )
    select
      v_event_id,
      tc.world_id,
      tc.region_id,
      tc.cell_id,
      tc.owner_id,
      p_authoritative_user_id,
      tc.paint_color_id,
      v_color,
      case
        when tc.owner_id is null then 'claim'
        when tc.owner_id <> p_authoritative_user_id then 'capture'
        else 'repaint'
      end,
      tc.area_m2,
      wr.version - 1,
      wr.version
    from public.territory_cells tc
    join public.world_regions wr
      on wr.id = tc.region_id and wr.world_id = tc.world_id
    where tc.world_id = v_world.id
      and tc.cell_id = any(v_candidate.target_cell_ids)
      and (
        tc.owner_id is distinct from p_authoritative_user_id
        or tc.paint_color_id is distinct from v_color
      );

    update public.territory_cells tc
    set
      owner_id = p_authoritative_user_id,
      paint_color_id = v_color,
      ownership_version = case
        when tc.owner_id is distinct from p_authoritative_user_id then wr.version
        else tc.ownership_version
      end,
      paint_version = case
        when tc.paint_color_id is distinct from v_color then wr.version
        else tc.paint_version
      end,
      last_claim_event_id = v_event_id,
      claimed_at = case
        when tc.owner_id is distinct from p_authoritative_user_id then now()
        else tc.claimed_at
      end
    from public.world_regions wr
    where tc.world_id = v_world.id
      and tc.region_id = wr.id
      and wr.world_id = tc.world_id
      and tc.cell_id = any(v_candidate.target_cell_ids)
      and (
        tc.owner_id is distinct from p_authoritative_user_id
        or tc.paint_color_id is distinct from v_color
      );

    -- Recalculate only the claimant and owners touched by this event. This is
    -- authoritative reconciliation from current cells, not a client delta.
    with affected_users(user_id) as (
      select p_authoritative_user_id
      union
      select distinct c.previous_owner_id
      from public.claim_cell_changes c
      where c.claim_event_id = v_event_id
        and c.previous_owner_id is not null
    ), recalculated as (
      select
        a.user_id,
        count(tc.cell_id)::bigint as cell_count,
        coalesce(sum(tc.area_m2), 0)::numeric(20, 6) as area_m2
      from affected_users a
      left join public.territory_cells tc
        on tc.world_id = v_world.id and tc.owner_id = a.user_id
      group by a.user_id
    )
    insert into public.player_scores(
      world_id,
      user_id,
      current_owned_cell_count,
      current_territory_area_m2,
      score_version
    )
    select
      v_world.id,
      r.user_id,
      r.cell_count,
      r.area_m2,
      v_world_version
    from recalculated r
    on conflict (world_id, user_id) do update
    set
      current_owned_cell_count = excluded.current_owned_cell_count,
      current_territory_area_m2 = excluded.current_territory_area_m2,
      score_version = excluded.score_version;

    update public.player_scores ps
    set lifetime_lost_area_m2 = ps.lifetime_lost_area_m2 + loss.area_m2
    from (
      select c.previous_owner_id as user_id, sum(c.area_m2) as area_m2
      from public.claim_cell_changes c
      where c.claim_event_id = v_event_id
        and c.previous_owner_id is not null
        and c.previous_owner_id <> p_authoritative_user_id
      group by c.previous_owner_id
    ) loss
    where ps.world_id = v_world.id
      and ps.user_id = loss.user_id;

    update public.player_scores
    set
      lifetime_claimed_area_m2 = lifetime_claimed_area_m2 + v_newly_claimed + v_captured,
      lifetime_captured_area_m2 = lifetime_captured_area_m2 + v_captured,
      claim_count = claim_count + 1,
      repaint_count = repaint_count + case when v_repainted > 0 then 1 else 0 end,
      largest_claim_area_m2 = greatest(largest_claim_area_m2, v_newly_claimed + v_captured)
    where world_id = v_world.id
      and user_id = p_authoritative_user_id;

    insert into public.notifications(
      recipient_id,
      actor_id,
      event_type,
      resource_type,
      resource_id,
      payload,
      world_id,
      source_event_id
    ) values (
      p_authoritative_user_id,
      null,
      'territory.claim_committed',
      'claim_event',
      v_event_id,
      jsonb_build_object(
        'newlyClaimedAreaM2', v_newly_claimed,
        'capturedAreaM2', v_captured,
        'alreadyOwnedAreaM2', v_already_owned,
        'repaintedAreaM2', v_repainted
      ),
      v_world.id,
      v_event_id
    )
    on conflict (recipient_id, source_event_id, event_type)
      where source_event_id is not null
    do nothing;

    insert into public.notifications(
      recipient_id,
      actor_id,
      event_type,
      resource_type,
      resource_id,
      payload,
      world_id,
      source_event_id
    )
    select
      c.previous_owner_id,
      p_authoritative_user_id,
      'territory.lost',
      'claim_event',
      v_event_id,
      jsonb_build_object('lostAreaM2', sum(c.area_m2)),
      v_world.id,
      v_event_id
    from public.claim_cell_changes c
    where c.claim_event_id = v_event_id
      and c.previous_owner_id is not null
      and c.previous_owner_id <> p_authoritative_user_id
    group by c.previous_owner_id
    on conflict (recipient_id, source_event_id, event_type)
      where source_event_id is not null
    do nothing;

    insert into public.realtime_outbox(
      world_id,
      region_id,
      claim_event_id,
      topic,
      event_type,
      dedupe_key,
      previous_version,
      version,
      payload
    )
    select
      v_world.id,
      rc.region_id,
      v_event_id,
      'world:' || v_world.id::text || ':region:' || rc.region_id::text,
      'region_patch',
      'claim:' || v_event_id::text || ':region:' || rc.region_id::text,
      wr.version - 1,
      wr.version,
      jsonb_strip_nulls(jsonb_build_object(
        'eventId', gen_random_uuid(),
        'type', 'region_patch',
        'worldId', v_world.id,
        'regionId', rc.region_id,
        'previousVersion', wr.version - 1,
        'version', wr.version,
        'claimEventId', v_event_id,
        'changedCells', case
          when rc.change_count <= v_rules.realtime_patch_cell_limit then rc.changed_cells
          else null
        end,
        'requiresRefetch', rc.change_count > v_rules.realtime_patch_cell_limit,
        'committedAtServer', now()
      ))
    from (
      select
        c.region_id,
        count(*) as change_count,
        jsonb_agg(
          jsonb_build_object(
            'cellId', c.cell_id,
            'ownerId', c.new_owner_id,
            'paintColorId', c.new_paint_color_id
          ) order by c.cell_id
        ) as changed_cells
      from public.claim_cell_changes c
      where c.claim_event_id = v_event_id
      group by c.region_id
    ) rc
    join public.world_regions wr
      on wr.id = rc.region_id and wr.world_id = v_world.id;

    insert into public.realtime_outbox(
      world_id,
      recipient_id,
      claim_event_id,
      topic,
      event_type,
      dedupe_key,
      payload
    ) values (
      v_world.id,
      p_authoritative_user_id,
      v_event_id,
      'user:' || p_authoritative_user_id::text || ':private',
      'claim_result',
      'claim:' || v_event_id::text || ':user:' || p_authoritative_user_id::text,
      jsonb_build_object(
        'eventId', gen_random_uuid(),
        'type', 'claim_result',
        'claimEventId', v_event_id,
        'worldVersion', v_world_version,
        'newlyClaimedAreaM2', v_newly_claimed,
        'capturedAreaM2', v_captured,
        'alreadyOwnedAreaM2', v_already_owned,
        'repaintedAreaM2', v_repainted,
        'finalTerritoryAreaM2', v_final_territory
      )
    );

    insert into public.realtime_outbox(
      world_id,
      recipient_id,
      claim_event_id,
      topic,
      event_type,
      dedupe_key,
      payload
    )
    select
      v_world.id,
      loss.user_id,
      v_event_id,
      'user:' || loss.user_id::text || ':private',
      'territory_lost',
      'claim:' || v_event_id::text || ':lost:' || loss.user_id::text,
      jsonb_build_object(
        'eventId', gen_random_uuid(),
        'type', 'territory_lost',
        'claimEventId', v_event_id,
        'lostAreaM2', loss.area_m2
      )
    from (
      select c.previous_owner_id as user_id, sum(c.area_m2) as area_m2
      from public.claim_cell_changes c
      where c.claim_event_id = v_event_id
        and c.previous_owner_id is not null
        and c.previous_owner_id <> p_authoritative_user_id
      group by c.previous_owner_id
    ) loss;

    update public.loop_candidates
    set status = 'claimed', claimed_event_id = v_event_id
    where id = v_candidate.id;

    v_result := jsonb_build_object(
      'status', 'accepted',
      'noOp', false,
      'commandId', v_command.id,
      'claimEventId', v_event_id,
      'worldVersion', v_world_version,
      'newlyClaimedAreaM2', v_newly_claimed,
      'capturedFromOthersAreaM2', v_captured,
      'alreadyOwnedAreaM2', v_already_owned,
      'restrictedAreaM2', 0,
      'repaintedAreaM2', v_repainted,
      'totalLoopAreaM2', v_total_loop,
      'finalTerritoryAreaM2', v_final_territory,
      'affectedRegionVersions', v_region_versions,
      'capturedFrom', v_captured_from
    );

    update public.claim_commands
    set status = 'COMMITTED', result_payload = v_result, completed_at = now()
    where id = v_command.id;

    insert into public.audit_events(
      actor_user_id, actor_type, action, target_type, target_id,
      world_id, correlation_id, after_state, metadata
    ) values (
      p_authoritative_user_id,
      'user',
      'claim.committed',
      'claim_event',
      v_event_id::text,
      v_world.id,
      v_correlation_id,
      jsonb_build_object('worldVersion', v_world_version),
      jsonb_build_object(
        'changedCellCount', (
          select count(*) from public.claim_cell_changes c where c.claim_event_id = v_event_id
        ),
        'affectedRegionCount', cardinality(v_changed_region_ids)
      )
    );

    return v_result;
  exception
    when serialization_failure or deadlock_detected then
      raise;
    when others then
      v_error_code := case sqlerrm
        when 'WORLD_NOT_ACCEPTING_CLAIMS' then 'WORLD_NOT_ACCEPTING_CLAIMS'
        when 'FOREIGN_SESSION_OR_CANDIDATE' then 'FOREIGN_SESSION_OR_CANDIDATE'
        when 'STALE_ROUTE_SESSION' then 'STALE_ROUTE_SESSION'
        when 'SIMULATION_NOT_ALLOWED' then 'SIMULATION_NOT_ALLOWED'
        when 'RISK_SCORE_TOO_HIGH' then 'RISK_SCORE_TOO_HIGH'
        when 'STALE_LOOP_CANDIDATE' then 'STALE_LOOP_CANDIDATE'
        when 'STALE_POINT_SEQUENCE' then 'STALE_POINT_SEQUENCE'
        when 'CLAIM_RATE_LIMITED' then 'CLAIM_RATE_LIMITED'
        when 'INVALID_CLAIM_GEOMETRY' then 'INVALID_CLAIM_GEOMETRY'
        when 'ROUTE_SEQUENCE_GAP' then 'ROUTE_SEQUENCE_GAP'
        when 'INVALID_TARGET_CELL_SET' then 'INVALID_TARGET_CELL_SET'
        when 'UNMATERIALIZED_TARGET_CELL' then 'UNMATERIALIZED_TARGET_CELL'
        when 'REGION_SET_MISMATCH' then 'REGION_SET_MISMATCH'
        when 'REGION_NOT_WRITABLE' then 'REGION_NOT_WRITABLE'
        when 'RESTRICTED_REGION' then 'RESTRICTED_REGION'
        else 'CLAIM_INTERNAL_ERROR'
      end;

      v_command_status := case
        when v_error_code = 'CLAIM_RATE_LIMITED' then 'REJECTED_RATE_LIMIT'
        when v_error_code = 'RESTRICTED_REGION' then 'REJECTED_RESTRICTED_REGION'
        when v_error_code in (
          'STALE_ROUTE_SESSION', 'STALE_LOOP_CANDIDATE', 'STALE_POINT_SEQUENCE',
          'WORLD_NOT_ACCEPTING_CLAIMS'
        ) then 'REJECTED_STALE_SESSION'
        when v_error_code in ('INVALID_CLAIM_GEOMETRY', 'INVALID_TARGET_CELL_SET')
          then 'REJECTED_INVALID_GEOMETRY'
        when v_error_code in (
          'FOREIGN_SESSION_OR_CANDIDATE', 'ROUTE_SEQUENCE_GAP',
          'UNMATERIALIZED_TARGET_CELL', 'REGION_SET_MISMATCH',
          'REGION_NOT_WRITABLE'
        ) then 'REJECTED_INVALID_ROUTE'
        when v_error_code in ('SIMULATION_NOT_ALLOWED', 'RISK_SCORE_TOO_HIGH')
          then 'REJECTED_IMPOSSIBLE_MOVEMENT'
        else 'FAILED_FINAL'
      end;

      v_result := jsonb_build_object(
        'status', 'rejected',
        'commandId', v_command.id,
        'errorCode', v_error_code
      );

      update public.claim_commands
      set
        status = v_command_status,
        error_code = v_error_code,
        result_payload = v_result,
        completed_at = now()
      where id = v_command.id;

      insert into public.audit_events(
        actor_user_id, actor_type, action, target_type, target_id,
        world_id, correlation_id, reason, metadata
      ) values (
        p_authoritative_user_id,
        'user',
        'claim.rejected',
        'claim_command',
        v_command.id::text,
        v_session.world_id,
        v_correlation_id,
        v_error_code,
        jsonb_build_object('commandStatus', v_command_status)
      );

      if v_error_code in (
        'FOREIGN_SESSION_OR_CANDIDATE', 'SIMULATION_NOT_ALLOWED',
        'RISK_SCORE_TOO_HIGH', 'ROUTE_SEQUENCE_GAP', 'REGION_SET_MISMATCH'
      ) then
        insert into public.risk_events(
          world_id, user_id, route_session_id, claim_command_id, risk_code,
          severity, score_delta, evidence, correlation_id
        ) values (
          v_session.world_id,
          p_authoritative_user_id,
          v_session.id,
          v_command.id,
          v_error_code,
          case
            when v_error_code in ('FOREIGN_SESSION_OR_CANDIDATE', 'SIMULATION_NOT_ALLOWED')
              then 'HIGH'
            else 'MEDIUM'
          end,
          case
            when v_error_code in ('FOREIGN_SESSION_OR_CANDIDATE', 'SIMULATION_NOT_ALLOWED')
              then 20
            else 10
          end,
          jsonb_build_object('operationType', 'close_loop'),
          v_correlation_id
        );
      end if;

      return v_result;
  end;
end;
$$;

revoke all on function app_private.execute_claim_command(
  uuid, uuid, uuid, bigint, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function app_private.execute_claim_command(
  uuid, uuid, uuid, bigint, text, text, text, uuid
) to service_role;

comment on function app_private.execute_claim_command(
  uuid, uuid, uuid, bigint, text, text, text, uuid
) is
  'Trusted server-only atomic claim. Polygon/cell/owner/score/client time kabul etmez; server-generated candidate üzerinden current state üzerinde commit eder.';

-- Preserve append-only guards while retaining the phase-7 complete account
-- deletion contract. The setting is transaction-local and cannot leak to a
-- later pooled request.
create or replace function app_private.delete_account(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted boolean := false;
  v_operation_id uuid := gen_random_uuid();
  v_released_cell_count bigint := 0;
begin
  if exists (
    select 1 from storage.objects
    where bucket_id = 'mrap-media'
      and (storage.foldername(name))[1] = p_user_id::text
  ) then
    raise exception using
      errcode = '23514',
      message = 'storage objects must be removed through the Storage API before account deletion';
  end if;

  perform set_config('mrap.allow_claim_history_purge', 'on', true);

  -- Remove references to the deleted user from surviving opponents' immutable
  -- event/result payloads. The local guard permits this legal redaction only in
  -- the same account-deletion transaction.
  update public.claim_events
  set lost_by_players = lost_by_players - p_user_id::text
  where lost_by_players ? p_user_id::text;

  update public.claim_commands cc
  set result_payload = jsonb_set(
    cc.result_payload,
    '{capturedFrom}',
    coalesce(
      (
        select jsonb_agg(item order by item ->> 'userId')
        from jsonb_array_elements(cc.result_payload -> 'capturedFrom') item
        where item ->> 'userId' <> p_user_id::text
      ),
      '[]'::jsonb
    ),
    true
  )
  where cc.result_payload is not null
    and jsonb_typeof(cc.result_payload -> 'capturedFrom') = 'array'
    and exists (
      select 1
      from jsonb_array_elements(cc.result_payload -> 'capturedFrom') item
      where item ->> 'userId' = p_user_id::text
    );

  select count(*) into v_released_cell_count
  from public.territory_cells
  where owner_id = p_user_id;

  -- Keep map caches correct when account deletion releases current cells. The
  -- invalidation has no deleted user ID or GPS data.
  perform 1
  from public.worlds w
  where exists (
    select 1 from public.territory_cells tc
    where tc.world_id = w.id and tc.owner_id = p_user_id
  )
  order by w.id
  for update;

  perform 1
  from public.world_regions wr
  where exists (
    select 1 from public.territory_cells tc
    where tc.world_id = wr.world_id
      and tc.region_id = wr.id
      and tc.owner_id = p_user_id
  )
  order by wr.world_id, wr.id
  for update;

  update public.worlds w
  set current_version = w.current_version + 1
  where exists (
    select 1 from public.territory_cells tc
    where tc.world_id = w.id and tc.owner_id = p_user_id
  );

  update public.world_regions wr
  set version = wr.version + 1
  where exists (
    select 1 from public.territory_cells tc
    where tc.world_id = wr.world_id
      and tc.region_id = wr.id
      and tc.owner_id = p_user_id
  );

  insert into public.realtime_outbox(
    world_id,
    region_id,
    topic,
    event_type,
    dedupe_key,
    previous_version,
    version,
    payload
  )
  select
    wr.world_id,
    wr.id,
    'world:' || wr.world_id::text || ':region:' || wr.id::text,
    'region_invalidation',
    'account-delete:' || v_operation_id::text || ':region:' || wr.id::text,
    wr.version - 1,
    wr.version,
    jsonb_build_object(
      'eventId', gen_random_uuid(),
      'type', 'region_invalidation',
      'worldId', wr.world_id,
      'regionId', wr.id,
      'previousVersion', wr.version - 1,
      'version', wr.version,
      'requiresRefetch', true,
      'reason', 'account_deleted',
      'committedAtServer', now()
    )
  from public.world_regions wr
  where exists (
    select 1 from public.territory_cells tc
    where tc.world_id = wr.world_id
      and tc.region_id = wr.id
      and tc.owner_id = p_user_id
  );

  update public.territory_cells tc
  set
    owner_id = null,
    paint_color_id = null,
    ownership_version = wr.version,
    paint_version = wr.version,
    last_claim_event_id = null,
    claimed_at = null
  from public.world_regions wr
  where tc.world_id = wr.world_id
    and tc.region_id = wr.id
    and tc.owner_id = p_user_id;

  delete from public.notifications where actor_id = p_user_id;
  delete from auth.users where id = p_user_id;
  v_deleted := found;
  delete from public.world_change_log where owner_id = p_user_id;

  if v_deleted then
    insert into public.audit_events(
      actor_user_id,
      actor_type,
      action,
      target_type,
      target_id,
      correlation_id,
      reason,
      metadata
    ) values (
      null,
      'service',
      'account.deleted',
      'account',
      null,
      v_operation_id,
      'Kullanıcı talebiyle tam hesap silme işlemi tamamlandı.',
      jsonb_build_object('releasedCellCount', v_released_cell_count)
    );
  end if;

  return v_deleted;
end;
$$;

revoke all on function app_private.delete_account(uuid)
  from public, anon, authenticated;
grant execute on function app_private.delete_account(uuid) to service_role;

comment on policy mrap_region_receive on realtime.messages is
  'Authenticated clients may receive only existing active region topics; no client authoritative send policy exists.';
comment on policy mrap_user_private_receive on realtime.messages is
  'A user may receive only user:{auth.uid}:private; another user topic cannot be guessed or read.';
