-- ============================================================
-- Travelers Inn · Migration 10: tiered pricing + occupancy surcharges
--
-- Replaces the linear nightly/hourly model with discrete, admin-configurable
-- RATE TIERS per room type (e.g. Couple: 3hrs ₱500 / 12hrs ₱850 / Overnight
-- ₱1250) plus occupancy surcharges (base_occupancy covered by the tier price;
-- ₱X per excess head up to max_occupancy).
--
--   * block tier    — a fixed same-day duration (3h, 12h). check-out is derived
--                     from check-in + duration; price is the flat tier price.
--   * overnight tier — multi-night; price = tier.price × nights, and the excess
--                     surcharge is charged per night.
--
-- Idempotent-friendly: guarded so re-runs on the hosted DB are safe.
-- ============================================================

-- ---- room_types: drop linear rates, add occupancy ---------------------------
alter table booking.room_types add column if not exists base_occupancy int not null default 1;
alter table booking.room_types add column if not exists max_occupancy int not null default 1;
alter table booking.room_types
  add column if not exists excess_person_rate numeric(10, 2) not null default 0;

do $$ begin
  alter table booking.room_types add constraint room_types_base_occupancy_positive
    check (base_occupancy >= 1);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table booking.room_types add constraint room_types_max_occupancy_gte_base
    check (max_occupancy >= base_occupancy);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table booking.room_types add constraint room_types_excess_rate_nonneg
    check (excess_person_rate >= 0);
exception when duplicate_object then null; end $$;

-- The old fn references booking.stay_type in its signature; drop it before the
-- type/column it depends on.
drop function if exists booking.fn_create_booking(
  text, text, text, uuid, booking.stay_type, timestamptz, timestamptz,
  booking.booking_source, text
);

alter table booking.room_types drop column if exists nightly_rate;
alter table booking.room_types drop column if exists hourly_rate;
alter table booking.room_types drop column if exists capacity;

-- ---- rate_tiers -------------------------------------------------------------
do $$ begin
  create type booking.tier_kind as enum ('block', 'overnight');
exception when duplicate_object then null; end $$;

create table if not exists booking.rate_tiers (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references booking.room_types (id) on delete cascade,
  label text not null,
  kind booking.tier_kind not null,
  duration_hours int check (duration_hours > 0),
  price numeric(10, 2) not null check (price >= 0),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- block tiers carry a fixed duration; overnight tiers are night-based.
  constraint rate_tiers_duration_matches_kind check (
    (kind = 'block' and duration_hours is not null)
    or (kind = 'overnight' and duration_hours is null)
  )
);
create index if not exists rate_tiers_room_type_id_idx on booking.rate_tiers (room_type_id);

do $$ begin
  create trigger set_updated_at before update on booking.rate_tiers
    for each row execute function booking.set_updated_at();
exception when duplicate_object then null; end $$;

alter table booking.rate_tiers enable row level security;

do $$ begin
  create policy rate_tiers_public_read on booking.rate_tiers for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy rate_tiers_admin_all on booking.rate_tiers for all
    using (booking.fn_is_admin())
    with check (booking.fn_is_admin());
exception when duplicate_object then null; end $$;

-- ---- bookings: tier reference + guest count ---------------------------------
alter table booking.bookings
  add column if not exists rate_tier_id uuid references booking.rate_tiers (id) on delete restrict;
alter table booking.bookings add column if not exists guest_count int not null default 1;
do $$ begin
  alter table booking.bookings add constraint bookings_guest_count_positive
    check (guest_count >= 1);
exception when duplicate_object then null; end $$;

alter table booking.bookings drop column if exists stay_type;
drop type if exists booking.stay_type;

-- ---- fn_create_booking: tier-aware, authoritative pricing -------------------
create or replace function booking.fn_create_booking(
  p_guest_name text,
  p_guest_phone text,
  p_guest_email text,
  p_room_type_id uuid,
  p_rate_tier_id uuid,
  p_guest_count int,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_source booking.booking_source,
  p_notes text default null
) returns booking.bookings language plpgsql security definer set search_path = '' as $$
declare
  v_type booking.room_types;
  v_tier booking.rate_tiers;
  v_check_out timestamptz;
  v_period tstzrange;
  v_nights int;
  v_excess_heads int;
  v_excess_per_unit numeric(10,2);
  v_total numeric(10,2);
  v_room record;
  v_booking booking.bookings;
begin
  select * into v_type from booking.room_types where id = p_room_type_id and is_active;
  if v_type.id is null then
    raise exception 'That room type is not bookable.';
  end if;

  select * into v_tier from booking.rate_tiers
    where id = p_rate_tier_id and room_type_id = p_room_type_id and is_active;
  if v_tier.id is null then
    raise exception 'That rate is not available for this room type.';
  end if;

  if p_guest_count < 1 then
    raise exception 'At least one guest is required.';
  end if;
  if p_guest_count > v_type.max_occupancy then
    raise exception 'This room accommodates at most % guests.', v_type.max_occupancy;
  end if;

  v_excess_heads := greatest(0, p_guest_count - v_type.base_occupancy);
  v_excess_per_unit := v_excess_heads * v_type.excess_person_rate;

  if v_tier.kind = 'block' then
    -- Fixed-duration day-use block: check-out derived from the tier; the excess
    -- surcharge (if any) applies once.
    v_check_out := p_check_in + make_interval(hours => v_tier.duration_hours);
    v_total := v_tier.price + v_excess_per_unit;
  else
    if p_check_out <= p_check_in then
      raise exception 'Check-out must be after check-in.';
    end if;
    v_nights := greatest(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 86400.0)::int);
    v_check_out := p_check_out;
    v_total := (v_tier.price + v_excess_per_unit) * v_nights;
  end if;

  v_period := tstzrange(p_check_in, v_check_out, '[)');

  for v_room in
    select r.id from booking.rooms r
    where r.room_type_id = p_room_type_id
      and r.status <> 'out_of_service'
      and not exists (
        select 1 from booking.bookings b
        where b.room_id = r.id
          and b.status in ('confirmed', 'checked_in')
          and b.period && v_period
      )
    order by r.label
  loop
    begin
      insert into booking.bookings
        (guest_name, guest_phone, guest_email, room_type_id, room_id, rate_tier_id,
         guest_count, period, source, quoted_total, notes, created_by)
      values
        (p_guest_name, nullif(p_guest_phone, ''), nullif(p_guest_email, ''),
         p_room_type_id, v_room.id, p_rate_tier_id, p_guest_count, v_period, p_source,
         v_total, nullif(p_notes, ''), (select auth.uid()))
      returning * into v_booking;
      return v_booking;
    exception when exclusion_violation then
      -- Lost the race for this room; try the next free one.
      continue;
    end;
  end loop;

  raise exception 'No rooms of that type are free for those dates.';
end;
$$;

grant execute on function booking.fn_create_booking(
  text, text, text, uuid, uuid, int, timestamptz, timestamptz,
  booking.booking_source, text
) to authenticated;
