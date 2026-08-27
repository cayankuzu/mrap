-- mrap production schema, phase 5: explicit post titles and private connection-list access.

alter table public.posts add column title text;

update public.posts
set title = case
  when char_length(trim(body)) > 0 then left(trim(body), 80)
  else 'Alan paylaşımı'
end
where title is null;

alter table public.posts alter column title set not null;
alter table public.posts
  add constraint posts_title_length check (char_length(trim(title)) between 1 and 80);

alter table public.posts add column map_snapshot_object_key text;
alter table public.posts
  add constraint posts_map_snapshot_owner_path check (
    map_snapshot_object_key is null
    or map_snapshot_object_key like author_id::text || '/%'
  );

-- Bir follow satırı iki ayrı liste bağlamına girebildiği için row-level SELECT,
-- gizli hesabın "takip" listesini güvenli biçimde ayırt edemez. Liste okumaları
-- hedef hesap bağlamını doğrulayan BFF/API üzerinden yapılır.
revoke select on public.follows, public.follow_requests from authenticated;

comment on column public.posts.title is
  'Sunumdan bağımsız, zorunlu gönderi başlığı; en fazla 80 karakter.';
comment on column public.posts.map_snapshot_object_key is
  'Kadraj editörünün private Storage içindeki doğrulanmış harita görseli anahtarı; data URL değildir.';
