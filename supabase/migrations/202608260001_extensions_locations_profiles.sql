-- mrap production schema, phase 1: extensions, normalized locations and profiles.
-- This migration targets a Supabase Postgres project. It is not used by the local SQLite adapter.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

create table public.countries (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  name_tr text not null check (char_length(name_tr) between 2 and 80),
  names jsonb not null default '{}'::jsonb check (jsonb_typeof(names) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cities (
  id text primary key check (id ~ '^[a-z]{2}-[a-z0-9-]{2,80}$'),
  country_code text not null references public.countries(code) on update cascade,
  name_tr text not null check (char_length(name_tr) between 2 and 100),
  names jsonb not null default '{}'::jsonb check (jsonb_typeof(names) = 'object'),
  centroid extensions.geography(Point, 4326),
  timezone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, country_code)
);

create index cities_country_active_idx on public.cities(country_code, is_active, name_tr);
create index cities_centroid_gix on public.cities using gist(centroid);

insert into public.countries(code, name_tr) values
  ('TR', 'Türkiye'),
  ('DE', 'Almanya'),
  ('US', 'Amerika Birleşik Devletleri'),
  ('GB', 'Birleşik Krallık'),
  ('FR', 'Fransa'),
  ('NL', 'Hollanda')
on conflict (code) do update set name_tr = excluded.name_tr;

insert into public.cities(id, country_code, name_tr) values
  ('tr-adana', 'TR', 'Adana'),
  ('tr-adiyaman', 'TR', 'Adıyaman'),
  ('tr-afyonkarahisar', 'TR', 'Afyonkarahisar'),
  ('tr-agri', 'TR', 'Ağrı'),
  ('tr-aksaray', 'TR', 'Aksaray'),
  ('tr-amasya', 'TR', 'Amasya'),
  ('tr-ankara', 'TR', 'Ankara'),
  ('tr-antalya', 'TR', 'Antalya'),
  ('tr-ardahan', 'TR', 'Ardahan'),
  ('tr-artvin', 'TR', 'Artvin'),
  ('tr-aydin', 'TR', 'Aydın'),
  ('tr-balikesir', 'TR', 'Balıkesir'),
  ('tr-bartin', 'TR', 'Bartın'),
  ('tr-batman', 'TR', 'Batman'),
  ('tr-bayburt', 'TR', 'Bayburt'),
  ('tr-bilecik', 'TR', 'Bilecik'),
  ('tr-bingol', 'TR', 'Bingöl'),
  ('tr-bitlis', 'TR', 'Bitlis'),
  ('tr-bolu', 'TR', 'Bolu'),
  ('tr-burdur', 'TR', 'Burdur'),
  ('tr-bursa', 'TR', 'Bursa'),
  ('tr-canakkale', 'TR', 'Çanakkale'),
  ('tr-cankiri', 'TR', 'Çankırı'),
  ('tr-corum', 'TR', 'Çorum'),
  ('tr-denizli', 'TR', 'Denizli'),
  ('tr-diyarbakir', 'TR', 'Diyarbakır'),
  ('tr-duzce', 'TR', 'Düzce'),
  ('tr-edirne', 'TR', 'Edirne'),
  ('tr-elazig', 'TR', 'Elazığ'),
  ('tr-erzincan', 'TR', 'Erzincan'),
  ('tr-erzurum', 'TR', 'Erzurum'),
  ('tr-eskisehir', 'TR', 'Eskişehir'),
  ('tr-gaziantep', 'TR', 'Gaziantep'),
  ('tr-giresun', 'TR', 'Giresun'),
  ('tr-gumushane', 'TR', 'Gümüşhane'),
  ('tr-hakkari', 'TR', 'Hakkâri'),
  ('tr-hatay', 'TR', 'Hatay'),
  ('tr-igdir', 'TR', 'Iğdır'),
  ('tr-isparta', 'TR', 'Isparta'),
  ('tr-istanbul', 'TR', 'İstanbul'),
  ('tr-izmir', 'TR', 'İzmir'),
  ('tr-kahramanmaras', 'TR', 'Kahramanmaraş'),
  ('tr-karabuk', 'TR', 'Karabük'),
  ('tr-karaman', 'TR', 'Karaman'),
  ('tr-kars', 'TR', 'Kars'),
  ('tr-kastamonu', 'TR', 'Kastamonu'),
  ('tr-kayseri', 'TR', 'Kayseri'),
  ('tr-kilis', 'TR', 'Kilis'),
  ('tr-kirikkale', 'TR', 'Kırıkkale'),
  ('tr-kirklareli', 'TR', 'Kırklareli'),
  ('tr-kirsehir', 'TR', 'Kırşehir'),
  ('tr-kocaeli', 'TR', 'Kocaeli'),
  ('tr-konya', 'TR', 'Konya'),
  ('tr-kutahya', 'TR', 'Kütahya'),
  ('tr-malatya', 'TR', 'Malatya'),
  ('tr-manisa', 'TR', 'Manisa'),
  ('tr-mardin', 'TR', 'Mardin'),
  ('tr-mersin', 'TR', 'Mersin'),
  ('tr-mugla', 'TR', 'Muğla'),
  ('tr-mus', 'TR', 'Muş'),
  ('tr-nevsehir', 'TR', 'Nevşehir'),
  ('tr-nigde', 'TR', 'Niğde'),
  ('tr-ordu', 'TR', 'Ordu'),
  ('tr-osmaniye', 'TR', 'Osmaniye'),
  ('tr-rize', 'TR', 'Rize'),
  ('tr-sakarya', 'TR', 'Sakarya'),
  ('tr-samsun', 'TR', 'Samsun'),
  ('tr-siirt', 'TR', 'Siirt'),
  ('tr-sinop', 'TR', 'Sinop'),
  ('tr-sivas', 'TR', 'Sivas'),
  ('tr-sanliurfa', 'TR', 'Şanlıurfa'),
  ('tr-sirnak', 'TR', 'Şırnak'),
  ('tr-tekirdag', 'TR', 'Tekirdağ'),
  ('tr-tokat', 'TR', 'Tokat'),
  ('tr-trabzon', 'TR', 'Trabzon'),
  ('tr-tunceli', 'TR', 'Tunceli'),
  ('tr-usak', 'TR', 'Uşak'),
  ('tr-van', 'TR', 'Van'),
  ('tr-yalova', 'TR', 'Yalova'),
  ('tr-yozgat', 'TR', 'Yozgat'),
  ('tr-zonguldak', 'TR', 'Zonguldak'),
  ('de-berlin', 'DE', 'Berlin'),
  ('de-hamburg', 'DE', 'Hamburg'),
  ('de-munih', 'DE', 'Münih'),
  ('de-koln', 'DE', 'Köln'),
  ('de-frankfurt', 'DE', 'Frankfurt'),
  ('de-stuttgart', 'DE', 'Stuttgart'),
  ('de-dusseldorf', 'DE', 'Düsseldorf'),
  ('us-new-york', 'US', 'New York'),
  ('us-los-angeles', 'US', 'Los Angeles'),
  ('us-chicago', 'US', 'Chicago'),
  ('us-houston', 'US', 'Houston'),
  ('us-san-francisco', 'US', 'San Francisco'),
  ('us-seattle', 'US', 'Seattle'),
  ('us-boston', 'US', 'Boston'),
  ('gb-londra', 'GB', 'Londra'),
  ('gb-manchester', 'GB', 'Manchester'),
  ('gb-birmingham', 'GB', 'Birmingham'),
  ('gb-edinburgh', 'GB', 'Edinburgh'),
  ('gb-glasgow', 'GB', 'Glasgow'),
  ('gb-liverpool', 'GB', 'Liverpool'),
  ('fr-paris', 'FR', 'Paris'),
  ('fr-marsilya', 'FR', 'Marsilya'),
  ('fr-lyon', 'FR', 'Lyon'),
  ('fr-toulouse', 'FR', 'Toulouse'),
  ('fr-nice', 'FR', 'Nice'),
  ('fr-bordeaux', 'FR', 'Bordeaux'),
  ('nl-amsterdam', 'NL', 'Amsterdam'),
  ('nl-rotterdam', 'NL', 'Rotterdam'),
  ('nl-lahey', 'NL', 'Lahey'),
  ('nl-utrecht', 'NL', 'Utrecht'),
  ('nl-eindhoven', 'NL', 'Eindhoven')
on conflict (id) do update set
  country_code = excluded.country_code,
  name_tr = excluded.name_tr;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username extensions.citext not null unique check (username::text ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(trim(display_name)) between 2 and 60),
  country_code text not null references public.countries(code),
  city_id text not null,
  bio text not null default '' check (char_length(bio) <= 180),
  color text not null default '#0D8BFF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  pattern smallint not null default 0 check (pattern between 0 and 15),
  account_visibility text not null default 'public' check (account_visibility in ('public', 'private')),
  avatar_object_key text check (avatar_object_key is null or avatar_object_key like id::text || '/%'),
  cover_object_key text check (cover_object_key is null or cover_object_key like id::text || '/%'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (city_id, country_code) references public.cities(id, country_code)
);

create index profiles_city_rank_idx on public.profiles(city_id, created_at);

create table public.profile_private (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  birth_date date not null,
  preferred_locale text not null default 'tr-TR' check (preferred_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  location_visibility text not null default 'private' check (location_visibility in ('private', 'approximate', 'friends')),
  updated_at timestamptz not null default now()
);

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function app_private.set_updated_at();

create trigger profile_private_set_updated_at
before update on public.profile_private
for each row execute function app_private.set_updated_at();

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(trim(new.raw_user_meta_data ->> 'username'));
  v_display_name text := trim(new.raw_user_meta_data ->> 'display_name');
  v_country_code text := upper(trim(coalesce(new.raw_user_meta_data ->> 'country_code', new.raw_user_meta_data ->> 'countryCode')));
  v_city_id text := trim(coalesce(new.raw_user_meta_data ->> 'city_id', new.raw_user_meta_data ->> 'cityId'));
  v_birth_date date;
  v_color text := coalesce(nullif(new.raw_user_meta_data ->> 'color', ''), '#0D8BFF');
begin
  if v_username is null or v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception using errcode = '22023', message = 'INVALID_USERNAME';
  end if;
  if v_display_name is null or char_length(v_display_name) not between 2 and 60 then
    raise exception using errcode = '22023', message = 'INVALID_DISPLAY_NAME';
  end if;
  if not exists (
    select 1 from public.cities
    where id = v_city_id and country_code = v_country_code and is_active = true
  ) then
    raise exception using errcode = '22023', message = 'INVALID_LOCATION';
  end if;
  begin
    v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date;
  exception when others then
    raise exception using errcode = '22023', message = 'INVALID_BIRTH_DATE';
  end;
  if v_birth_date > (current_date - interval '13 years')::date
     or v_birth_date < (current_date - interval '125 years')::date then
    raise exception using errcode = '22023', message = 'INVALID_AGE';
  end if;
  if v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception using errcode = '22023', message = 'INVALID_COLOR';
  end if;

  insert into public.profiles(id, username, display_name, country_code, city_id, color)
  values (new.id, v_username, v_display_name, v_country_code, v_city_id, v_color);

  insert into public.profile_private(user_id, birth_date)
  values (new.id, v_birth_date);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function app_private.handle_new_auth_user();
