-- mrap production schema, phase 6: full tracking-session aggregates.
-- Claim-loop distance remains in claim_history; profile distance comes from this table.

create table public.route_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 100),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  location_mode text not null check (location_mode in ('real', 'simulation')),
  distance_m double precision not null check (distance_m between 0 and 250000),
  duration_seconds integer not null check (duration_seconds between 0 and 86400),
  point_count integer not null check (point_count between 1 and 10000),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (player_id, idempotency_key),
  check (started_at <= ended_at)
);

create index route_sessions_player_ended_idx
  on public.route_sessions(player_id, ended_at desc, id desc);

alter table public.route_sessions enable row level security;
revoke all on table public.route_sessions from anon, authenticated;
grant select on table public.route_sessions to authenticated;
grant all on table public.route_sessions to service_role;

create policy route_sessions_read_self
on public.route_sessions for select
to authenticated
using ((select auth.uid()) = player_id);

comment on table public.route_sessions is
  'Tam takip oturumunun yalnızca doğrulanmış toplamları. Ham GPS noktaları kalıcı olarak saklanmaz.';
comment on column public.route_sessions.distance_m is
  'Alan claim döngüsünden bağımsız, aktif takip oturumunda izlenen tüm yol.';
