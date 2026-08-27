alter table public.posts
  add column if not exists map_view jsonb;

alter table public.posts
  drop constraint if exists posts_map_view_valid;

alter table public.posts
  add constraint posts_map_view_valid check (
    map_view is null or (
      jsonb_typeof(map_view) = 'object'
      and map_view ?& array['center', 'zoom', 'bearing', 'pitch']
      and jsonb_typeof(map_view -> 'center') = 'array'
      and jsonb_array_length(map_view -> 'center') = 2
      and jsonb_typeof(map_view -> 'center' -> 0) = 'number'
      and jsonb_typeof(map_view -> 'center' -> 1) = 'number'
      and (map_view -> 'center' ->> 0)::double precision between -180 and 180
      and (map_view -> 'center' ->> 1)::double precision between -85 and 85
      and jsonb_typeof(map_view -> 'zoom') = 'number'
      and jsonb_typeof(map_view -> 'bearing') = 'number'
      and jsonb_typeof(map_view -> 'pitch') = 'number'
      and (map_view ->> 'zoom')::double precision between 1 and 22
      and (map_view ->> 'bearing')::double precision between -180 and 180
      and (map_view ->> 'pitch')::double precision between 0 and 60
    )
  );

comment on column public.posts.map_view is
  'Paylaşım mini haritasının kaydedilmiş merkez, zoom, bearing ve pitch kadrajı.';
