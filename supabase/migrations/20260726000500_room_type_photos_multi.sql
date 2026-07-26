-- ============================================================
-- Travelers Inn · Migration 15: multiple photos per room type
--
-- room_types.image_url is KEPT as the cover image and stays synced to the
-- lowest-sort_order photo, so existing readers (portal cards, OG metadata, the
-- room-types table thumbnail) keep working untouched. Reuses the existing
-- PUBLIC travelers-inn-room-photos bucket and its policies — no new bucket.
-- ============================================================

create table if not exists booking.room_type_photos (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references booking.room_types (id) on delete cascade,
  storage_path text not null,
  url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists room_type_photos_room_type_id_idx
  on booking.room_type_photos (room_type_id, sort_order);

alter table booking.room_type_photos enable row level security;

-- Public read: the portal gallery is anonymous.
do $$ begin
  create policy room_type_photos_public_read on booking.room_type_photos
    for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy room_type_photos_admin_all on booking.room_type_photos for all
    using (booking.fn_is_admin())
    with check (booking.fn_is_admin());
exception when duplicate_object then null; end $$;

-- Backfill: every type that already has a cover gets a photo row, so the
-- gallery editor opens pre-populated rather than looking empty.
insert into booking.room_type_photos (room_type_id, storage_path, url, sort_order)
select rt.id, '', rt.image_url, 0
from booking.room_types rt
where rt.image_url is not null
  and rt.image_url <> ''
  and not exists (
    select 1 from booking.room_type_photos p where p.room_type_id = rt.id
  );
