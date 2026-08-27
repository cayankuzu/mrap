-- mrap production schema, phase 3: social graph, posts and object-storage media metadata.
-- Binary image data never belongs in these tables.

create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create index follows_followed_created_idx on public.follows(followed_id, created_at desc);

create table public.follow_requests (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_id),
  check (requester_id <> target_id)
);

create index follow_requests_target_created_idx on public.follow_requests(target_id, created_at desc);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  claim_id uuid not null,
  body text not null default '' check (char_length(body) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, author_id),
  foreign key (claim_id, author_id) references public.claim_history(id, player_id) on delete cascade
);

create index posts_author_created_idx on public.posts(author_id, created_at desc, id desc);
create index posts_created_idx on public.posts(created_at desc, id desc);

create trigger posts_set_updated_at
before update on public.posts
for each row execute function app_private.set_updated_at();

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  object_key text not null unique check (char_length(object_key) between 10 and 500),
  sort_order smallint not null check (sort_order between 0 and 5),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 2097152),
  width integer not null check (width between 1 and 12000),
  height integer not null check (height between 1 and 12000),
  blurhash text check (blurhash is null or char_length(blurhash) <= 200),
  created_at timestamptz not null default now(),
  unique (post_id, sort_order),
  check (object_key like owner_id::text || '/%'),
  foreign key (post_id, owner_id) references public.posts(id, author_id) on delete cascade
);

create index post_media_owner_idx on public.post_media(owner_id, created_at desc);

create table public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index likes_post_created_idx on public.likes(post_id, created_at desc);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  body text not null check (char_length(body) <= 300 and char_length(trim(body)) >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_post_created_idx on public.comments(post_id, created_at desc, id desc);

create trigger comments_set_updated_at
before update on public.comments
for each row execute function app_private.set_updated_at();

create table public.saved_posts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index saved_posts_user_created_idx on public.saved_posts(user_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  resource_type text check (resource_type is null or resource_type ~ '^[a-z][a-z0-9_.-]{1,31}$'),
  resource_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_recipient_created_idx on public.notifications(recipient_id, created_at desc);
create index notifications_recipient_unread_idx on public.notifications(recipient_id, created_at desc) where read_at is null;

comment on table public.post_media is
  'Yalnızca doğrulanmış object-storage anahtarları ve medya metadata bilgisi. Base64/blob burada saklanmaz.';
comment on table public.notifications is
  'Yerelleştirilmiş cümle değil event kodu ve payload saklanır; Türkçe metin sunum katmanında üretilir.';
