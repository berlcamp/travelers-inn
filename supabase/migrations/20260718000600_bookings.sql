-- ============================================================
-- Travelers Inn · Migration 6: bookings + the double-booking guarantee
--
-- Every stay is a tstzrange against an assigned room. A GiST exclusion
-- constraint (needs btree_gist for the uuid equality operator) makes two
-- overlapping ACTIVE bookings on the same room impossible at the DB layer —
-- the race-safe core of the whole system.
-- ============================================================

create extension if not exists btree_gist with schema extensions;

create type booking.booking_status as enum
  ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');
create type booking.stay_type as enum ('nightly', 'hourly');
create type booking.booking_source as enum ('portal', 'walk_in', 'staff');
create type booking.payment_status as enum ('unpaid', 'partial', 'paid');

-- Short human-friendly code shown on confirmations, e.g. TI-9F3A2C.
create or replace function booking.gen_reference_code()
returns text language sql volatile as $$
  select 'TI-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
$$;

create table booking.bookings (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique default booking.gen_reference_code(),
  guest_name text not null,
  guest_phone text,
  guest_email text,
  room_type_id uuid not null references booking.room_types (id) on delete restrict,
  room_id uuid not null references booking.rooms (id) on delete restrict,
  stay_type booking.stay_type not null,
  period tstzrange not null,
  status booking.booking_status not null default 'confirmed',
  source booking.booking_source not null default 'staff',
  quoted_total numeric(10, 2) not null check (quoted_total >= 0),
  payment_status booking.payment_status not null default 'unpaid',
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_period_valid check (not isempty(period) and lower(period) < upper(period))
);

-- No two ACTIVE bookings on the same room may overlap.
alter table booking.bookings
  add constraint no_overlap
  exclude using gist (room_id with =, period with &&)
  where (status in ('confirmed', 'checked_in'));

create index bookings_room_period_idx on booking.bookings using gist (room_id, period);
create index bookings_status_idx on booking.bookings (status);
create index bookings_room_type_idx on booking.bookings (room_type_id);
create index bookings_period_lower_idx on booking.bookings (lower(period));

create trigger set_updated_at before update on booking.bookings
  for each row execute function booking.set_updated_at();

alter table booking.bookings enable row level security;

-- Staff only. No public read (a guest must never list others' bookings). The
-- M5 portal creates bookings through fn_create_booking (SECURITY DEFINER),
-- never via direct table access.
create policy bookings_staff_read on booking.bookings for select
  using (booking.fn_is_active_user());
create policy bookings_staff_write on booking.bookings for all
  using (booking.fn_is_active_user())
  with check (booking.fn_is_active_user());
