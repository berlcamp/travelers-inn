-- ============================================================
-- Travelers Inn · Migration 5: room types + rooms
--
-- room_types carry the pricing (nightly + optional hourly); rooms are the
-- physical inventory of a type, each with a housekeeping status. Both are
-- publicly readable so the M5 booking portal can show availability + prices to
-- anonymous visitors; writes are staff-only.
-- ============================================================

create type booking.room_status as enum ('vacant', 'occupied', 'cleaning', 'out_of_service');

create table booking.room_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  capacity int not null default 2 check (capacity > 0),
  nightly_rate numeric(10, 2) not null check (nightly_rate >= 0),
  hourly_rate numeric(10, 2) check (hourly_rate >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index room_types_name_key on booking.room_types (lower(name));

create table booking.rooms (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references booking.room_types (id) on delete restrict,
  label text not null,
  status booking.room_status not null default 'vacant',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index rooms_label_key on booking.rooms (lower(label));
create index rooms_room_type_id_idx on booking.rooms (room_type_id);

create trigger set_updated_at before update on booking.room_types
  for each row execute function booking.set_updated_at();
create trigger set_updated_at before update on booking.rooms
  for each row execute function booking.set_updated_at();

alter table booking.room_types enable row level security;
alter table booking.rooms enable row level security;

-- Public read (portal inventory + prices).
create policy room_types_public_read on booking.room_types for select using (true);
create policy rooms_public_read on booking.rooms for select using (true);

-- Room types: admin-only writes.
create policy room_types_admin_all on booking.room_types for all
  using (booking.fn_is_admin())
  with check (booking.fn_is_admin());

-- Rooms: admins manage everything; active staff (front desk) may update status.
create policy rooms_admin_all on booking.rooms for all
  using (booking.fn_is_admin())
  with check (booking.fn_is_admin());
create policy rooms_staff_update on booking.rooms for update to authenticated
  using (booking.fn_is_active_user())
  with check (booking.fn_is_active_user());
