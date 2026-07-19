-- ============================================================
-- Travelers Inn · Migration: room-type cover photos
--
-- One cover photo per room type. The public URL is stored on the room type;
-- the bytes live in a Supabase Storage bucket. Because this is a SHARED
-- Supabase project (same storage as prime-hrm et al.), the bucket is
-- namespaced and every storage policy is scoped to bucket_id, so these rules
-- are strictly additive and cannot touch other projects' objects.
-- ============================================================

alter table booking.room_types add column if not exists image_url text;

-- Public bucket: portal readers are anonymous, so objects must be world-readable.
insert into storage.buckets (id, name, public)
values ('travelers-inn-room-photos', 'travelers-inn-room-photos', true)
on conflict (id) do nothing;

-- CREATE POLICY has no IF NOT EXISTS; drop-then-create keeps this reapplyable.
drop policy if exists ti_room_photos_public_read on storage.objects;
drop policy if exists ti_room_photos_admin_insert on storage.objects;
drop policy if exists ti_room_photos_admin_update on storage.objects;
drop policy if exists ti_room_photos_admin_delete on storage.objects;

-- Anyone may read (public portal shows the photo without a login).
create policy ti_room_photos_public_read on storage.objects for select
  using (bucket_id = 'travelers-inn-room-photos');

-- Only admins may write — matches room-type CRUD, which is admin-only.
create policy ti_room_photos_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'travelers-inn-room-photos' and booking.fn_is_admin());
create policy ti_room_photos_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'travelers-inn-room-photos' and booking.fn_is_admin())
  with check (bucket_id = 'travelers-inn-room-photos' and booking.fn_is_admin());
create policy ti_room_photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'travelers-inn-room-photos' and booking.fn_is_admin());
