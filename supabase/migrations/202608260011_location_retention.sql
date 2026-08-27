-- Raw GPS batches are deliberately short-lived. This RPC is exposed only to
-- the trusted service role so a scheduled backend job can enforce retention
-- without exposing route points to clients.

create or replace function public.purge_expired_location_data(p_limit integer default 25000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25000), 1), 50000);
  v_deleted integer := 0;
  v_has_more boolean := false;
begin
  with doomed as (
    select batch.id
    from public.route_point_batches as batch
    where batch.expires_at <= statement_timestamp()
    order by batch.expires_at, batch.id
    limit v_limit
    for update skip locked
  )
  delete from public.route_point_batches as batch
  using doomed
  where batch.id = doomed.id;

  get diagnostics v_deleted = row_count;

  select exists (
    select 1
    from public.route_point_batches as batch
    where batch.expires_at <= statement_timestamp()
  ) into v_has_more;

  return jsonb_build_object(
    'deletedBatches', v_deleted,
    'hasMore', v_has_more,
    'completedAt', statement_timestamp()
  );
end;
$$;

revoke all on function public.purge_expired_location_data(integer) from public;
revoke all on function public.purge_expired_location_data(integer) from anon;
revoke all on function public.purge_expired_location_data(integer) from authenticated;
grant execute on function public.purge_expired_location_data(integer) to service_role;

comment on function public.purge_expired_location_data(integer) is
  'Deletes expired raw GPS point batches in a bounded, skip-locked service-role job.';
