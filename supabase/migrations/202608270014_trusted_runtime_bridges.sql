-- mrap production schema, phase 14: narrow PostgREST bridges for the trusted
-- Next.js backend. app_private remains outside the exposed Data API schemas.

begin;

create or replace function public.mrap_runtime_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.runtime_contract()
$$;

create or replace function public.mrap_identity_user_id(
  p_email text default null,
  p_username text default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_username text := app_private.normalize_username(p_username);
  v_user_id uuid;
begin
  if num_nonnulls(p_email, p_username) <> 1 then
    raise exception using errcode = '22023', message = 'EXACTLY_ONE_IDENTITY_REQUIRED';
  end if;

  if p_email is not null then
    if char_length(v_email) not between 3 and 254 then
      raise exception using errcode = '22023', message = 'INVALID_EMAIL_LOOKUP';
    end if;
    select u.id into v_user_id
    from auth.users u
    where lower(u.email) = v_email
    limit 1;
  else
    if char_length(v_username) not between 3 and 20 then
      raise exception using errcode = '22023', message = 'INVALID_USERNAME_LOOKUP';
    end if;
    select p.id into v_user_id
    from public.profiles p
    where p.username_key = v_username
    limit 1;
  end if;

  return v_user_id;
end;
$$;

create or replace function public.mrap_consume_rate_limit(
  p_scope_hash text,
  p_maximum_hits integer,
  p_window_ms integer
)
returns table(allowed boolean, remaining integer, retry_after_seconds integer)
language sql
volatile
security definer
set search_path = ''
as $$
  select *
  from app_private.consume_rate_limit(p_scope_hash, p_maximum_hits, p_window_ms)
$$;

create or replace function public.mrap_delete_account(p_user_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select app_private.delete_account(p_user_id)
$$;

create or replace function public.mrap_execute_claim_command(
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
language sql
volatile
security definer
set search_path = ''
as $$
  select app_private.execute_claim_command(
    p_authoritative_user_id,
    p_route_session_id,
    p_loop_candidate_id,
    p_last_accepted_point_sequence,
    p_selected_color_id,
    p_idempotency_key,
    p_payload_hash,
    p_correlation_id
  )
$$;

revoke all on function public.mrap_runtime_contract() from public, anon, authenticated;
revoke all on function public.mrap_identity_user_id(text, text) from public, anon, authenticated;
revoke all on function public.mrap_consume_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.mrap_delete_account(uuid) from public, anon, authenticated;
revoke all on function public.mrap_execute_claim_command(uuid, uuid, uuid, bigint, text, text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.mrap_runtime_contract() to service_role;
grant execute on function public.mrap_identity_user_id(text, text) to service_role;
grant execute on function public.mrap_consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.mrap_delete_account(uuid) to service_role;
grant execute on function public.mrap_execute_claim_command(uuid, uuid, uuid, bigint, text, text, text, uuid)
  to service_role;

comment on function public.mrap_identity_user_id(text, text) is
  'Trusted BFF identity existence lookup. Never executable by anon/authenticated roles.';
comment on function public.mrap_execute_claim_command(uuid, uuid, uuid, bigint, text, text, text, uuid) is
  'Narrow Data API bridge into the authoritative app_private claim transaction.';

commit;
