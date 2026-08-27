-- mrap production schema, phase 7: immutable live-location privacy and
-- service-role-only complete account deletion.

update public.profile_private
set location_visibility = 'private'
where location_visibility <> 'private';

alter table public.profile_private
  drop constraint if exists profile_private_location_visibility_check;
alter table public.profile_private
  add constraint profile_private_location_visibility_check
  check (location_visibility = 'private');

create or replace function app_private.delete_account(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted boolean := false;
begin
  -- Storage nesneleri SQL ile silinmez: bu yalnız metadata'yı kaldırıp gerçek
  -- dosyayı orphan bırakır. Güvenilir backend önce Storage API `remove` ile
  -- kullanıcının klasörünü boşaltmalı, sonra bu RPC'yi çağırmalıdır.
  if exists (
    select 1 from storage.objects
    where bucket_id = 'mrap-media'
      and (storage.foldername(name))[1] = p_user_id::text
  ) then
    raise exception using
      errcode = '23514',
      message = 'storage objects must be removed through the Storage API before account deletion';
  end if;

  -- Kullanıcının başka hesapların kutularında bıraktığı sosyal olayları da
  -- actor FK'si null'a dönmeden önce temizle.
  delete from public.notifications where actor_id = p_user_id;

  delete from auth.users where id = p_user_id;
  v_deleted := found;

  -- Territory/paint cascade trigger'ları silme sırasında son bir dünya değişikliği
  -- kaydı üretebilir. Hesapla ilişkilendirilebilen bu geçmişi de ardından kaldır.
  delete from public.world_change_log where owner_id = p_user_id;

  return v_deleted;
end;
$$;

revoke all on function app_private.delete_account(uuid) from public, anon, authenticated;
grant execute on function app_private.delete_account(uuid) to service_role;

comment on function app_private.delete_account(uuid) is
  'Yalnızca güvenilir backend service_role üzerinden, Storage API temizliği tamamlandıktan sonra çağrılır; auth kullanıcısını ve ilişkili satırları cascade ile kalıcı olarak siler.';
