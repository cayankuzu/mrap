-- mrap production schema, phase 4: least-privilege RLS, private media and Realtime invalidation.

alter table public.countries enable row level security;
alter table public.cities enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.world_state enable row level security;
alter table public.territory_current enable row level security;
alter table public.claim_history enable row level security;
alter table public.paint_current enable row level security;
alter table public.world_change_log enable row level security;
alter table public.follows enable row level security;
alter table public.follow_requests enable row level security;
alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.saved_posts enable row level security;
alter table public.notifications enable row level security;

create or replace function app_private.can_view_profile_content(p_viewer uuid, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_viewer = p_owner
    or exists (
      select 1 from public.profiles
      where id = p_owner and account_visibility = 'public'
    )
    or exists (
      select 1 from public.follows
      where follower_id = p_viewer and followed_id = p_owner
    );
$$;

create or replace function app_private.can_view_post(p_viewer uuid, p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.posts
    where id = p_post
      and app_private.can_view_profile_content(p_viewer, author_id)
  );
$$;

revoke all on function app_private.can_view_profile_content(uuid, uuid) from public;
revoke all on function app_private.can_view_post(uuid, uuid) from public;
revoke execute on all functions in schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.can_view_profile_content(uuid, uuid) to authenticated;
grant execute on function app_private.can_view_post(uuid, uuid) to authenticated;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.countries, public.cities to anon, authenticated;
grant select on public.profiles, public.world_state, public.territory_current,
  public.claim_history, public.paint_current, public.world_change_log,
  public.follows, public.follow_requests, public.posts, public.post_media,
  public.likes, public.comments, public.saved_posts, public.notifications
to authenticated;
grant select on public.profile_private to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

create policy countries_read_active
on public.countries for select
to anon, authenticated
using (is_active = true);

create policy cities_read_active
on public.cities for select
to anon, authenticated
using (is_active = true);

create policy profiles_read_authenticated
on public.profiles for select
to authenticated
using (true);

create policy profile_private_read_self
on public.profile_private for select
to authenticated
using ((select auth.uid()) = user_id);

create policy world_state_read_authenticated
on public.world_state for select
to authenticated
using (true);

create policy territory_current_read_authenticated
on public.territory_current for select
to authenticated
using (true);

create policy claim_history_read_authenticated
on public.claim_history for select
to authenticated
using (app_private.can_view_profile_content((select auth.uid()), player_id));

create policy paint_current_read_authenticated
on public.paint_current for select
to authenticated
using (true);

create policy world_change_log_read_authenticated
on public.world_change_log for select
to authenticated
using (true);

create policy follows_read_authenticated
on public.follows for select
to authenticated
using (true);

create policy follow_requests_read_participants
on public.follow_requests for select
to authenticated
using ((select auth.uid()) in (requester_id, target_id));

create policy posts_read_allowed
on public.posts for select
to authenticated
using (app_private.can_view_profile_content((select auth.uid()), author_id));

create policy post_media_read_allowed
on public.post_media for select
to authenticated
using (app_private.can_view_post((select auth.uid()), post_id));

create policy likes_read_allowed
on public.likes for select
to authenticated
using (app_private.can_view_post((select auth.uid()), post_id));

create policy comments_read_allowed
on public.comments for select
to authenticated
using (app_private.can_view_post((select auth.uid()), post_id));

create policy saved_posts_read_self
on public.saved_posts for select
to authenticated
using ((select auth.uid()) = user_id);

create policy notifications_read_self
on public.notifications for select
to authenticated
using ((select auth.uid()) = recipient_id);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'mrap-media',
  'mrap-media',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy mrap_media_owner_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'mrap-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy mrap_media_owner_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'mrap-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy mrap_media_owner_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'mrap-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'mrap-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy mrap_media_owner_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'mrap-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists mrap_world_receive on realtime.messages;
create policy mrap_world_receive
on realtime.messages for select
to authenticated
using ((select realtime.topic()) = 'world:territory');

create or replace function app_private.broadcast_world_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'version', new.version,
      'entity', new.entity,
      'operation', new.operation,
      'ownerId', new.owner_id,
      'chunkKey', new.chunk_key,
      'changedBbox', extensions.st_asgeojson(new.changed_bbox, 6)::jsonb
    ),
    'territory_invalidated',
    'world:territory',
    true
  );
  return new;
end;
$$;

create trigger world_change_log_broadcast
after insert on public.world_change_log
for each row execute function app_private.broadcast_world_invalidation();

revoke all on function app_private.broadcast_world_invalidation() from public, anon, authenticated;

-- Bu policy yalnızca tamamlanmış dünya değişimi invalidation mesajını
-- yayınlar; aktif GPS veya rota hiçbir zaman Realtime kanalına gönderilmez.
