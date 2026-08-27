-- mrap adapter parity: compact search, social mutation idempotency and legal consent evidence.
-- Additive only; deploy with the Supabase CLI after reviewing production data. Not executed by local tests.

create or replace function app_private.profile_search_key(p_username text, p_display_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select trim(regexp_replace(
    translate(lower(p_username || ' ' || p_display_name), 'çğıöşüâîû', 'cgiosuaiu'),
    '[^a-z0-9_]+', ' ', 'g'
  ));
$$;

alter table public.profiles
  add column if not exists search_key text
  generated always as (app_private.profile_search_key(username::text, display_name)) stored;

create index if not exists profiles_search_key_idx on public.profiles(search_key, id);

alter table public.posts
  add column if not exists idempotency_key text
    check (idempotency_key is null or char_length(idempotency_key) between 16 and 100),
  add column if not exists payload_hash text
    check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$');

alter table public.comments
  add column if not exists idempotency_key text
    check (idempotency_key is null or char_length(idempotency_key) between 16 and 100),
  add column if not exists payload_hash text
    check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists posts_author_idempotency_idx
  on public.posts(author_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists comments_user_post_idempotency_idx
  on public.comments(user_id, post_id, idempotency_key)
  where idempotency_key is not null;

alter table public.posts
  add constraint posts_idempotency_pair_check
  check ((idempotency_key is null) = (payload_hash is null)) not valid;

alter table public.comments
  add constraint comments_idempotency_pair_check
  check ((idempotency_key is null) = (payload_hash is null)) not valid;

-- Existing rows are not scanned during rollout; every new/updated row is constrained.
alter table public.post_media
  add constraint post_media_decode_budget_check
  check (
    width <= 2560
    and height <= 2560
    and width::bigint * height::bigint <= 6553600
    and greatest(width, height)::numeric / least(width, height)::numeric <= 12
  ) not valid;

create table if not exists public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  terms_version text not null check (char_length(terms_version) between 1 and 40),
  privacy_version text not null check (char_length(privacy_version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  unique (user_id, terms_version, privacy_version)
);

alter table public.legal_consents enable row level security;
revoke all on public.legal_consents from anon, authenticated;
grant select on public.legal_consents to authenticated;

create policy legal_consents_select_own
on public.legal_consents
for select
to authenticated
using (user_id = (select auth.uid()));

comment on table public.legal_consents is
  'Versioned evidence of explicit terms/privacy acceptance; no IP or user-agent is retained.';
