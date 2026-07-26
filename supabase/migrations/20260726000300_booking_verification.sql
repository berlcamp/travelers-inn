-- ============================================================
-- Travelers Inn · Migration 13: deposit verification
--
-- A portal guest now pays a deposit up front and uploads proof. The booking is
-- created as 'pending_verification' and HOLDS ITS ROOM: the status joins the
-- no_overlap exclusion constraint, so a guest who has paid can never lose the
-- room to a later booker. Every availability function is widened to match, or
-- counts would over-report free rooms.
--
-- Proofs are financial documents (names, reference numbers), so unlike the room
-- photo bucket this one is PRIVATE — staff read via short-lived signed URLs.
-- Every storage policy is scoped by bucket_id, so these rules cannot touch
-- other projects' objects in this shared Supabase instance.
-- ============================================================

-- ---- the double-booking guarantee, widened ---------------------------------
alter table booking.bookings drop constraint if exists no_overlap;
alter table booking.bookings
  add constraint no_overlap
  exclude using gist (room_id with =, period with &&)
  where (status in ('pending_verification', 'confirmed', 'checked_in'));

-- ---- proofs -----------------------------------------------------------------
create table if not exists booking.booking_proofs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references booking.bookings (id) on delete cascade,
  method booking.payment_method not null,
  reference_no text,
  declared_amount numeric(10, 2) not null check (declared_amount > 0),
  storage_path text not null,
  created_at timestamptz not null default now(),
  constraint booking_proofs_method_allowed check (method in ('gcash', 'bank_transfer'))
);
create index if not exists booking_proofs_booking_id_idx
  on booking.booking_proofs (booking_id);

alter table booking.booking_proofs enable row level security;

-- Staff only. The portal writes through the admin client inside a server
-- action, exactly as it already does for fn_create_booking.
do $$ begin
  create policy booking_proofs_staff_read on booking.booking_proofs for select
    using (booking.fn_is_active_user());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy booking_proofs_staff_write on booking.booking_proofs for all
    using (booking.fn_is_active_user())
    with check (booking.fn_is_active_user());
exception when duplicate_object then null; end $$;

-- ---- private proof bucket ---------------------------------------------------
insert into storage.buckets (id, name, public)
values ('travelers-inn-payment-proofs', 'travelers-inn-payment-proofs', false)
on conflict (id) do nothing;

drop policy if exists ti_proofs_staff_read on storage.objects;
drop policy if exists ti_proofs_staff_insert on storage.objects;
drop policy if exists ti_proofs_admin_delete on storage.objects;

-- NO anon select policy: proofs are never world-readable.
create policy ti_proofs_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'travelers-inn-payment-proofs' and booking.fn_is_active_user());
create policy ti_proofs_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'travelers-inn-payment-proofs' and booking.fn_is_active_user());
create policy ti_proofs_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'travelers-inn-payment-proofs' and booking.fn_is_admin());

-- ---- availability functions, widened ---------------------------------------
create or replace function booking.fn_count_available(
  p_room_type_id uuid, p_check_in timestamptz, p_check_out timestamptz
) returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from booking.rooms r
  where r.room_type_id = p_room_type_id
    and r.status <> 'out_of_service'
    and not exists (
      select 1 from booking.bookings b
      where b.room_id = r.id
        and b.status in ('pending_verification', 'confirmed', 'checked_in')
        and b.period && tstzrange(p_check_in, p_check_out, '[)')
    );
$$;

create or replace function booking.fn_available_rooms(
  p_room_type_id uuid,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_exclude_booking uuid default null
) returns setof booking.rooms language sql stable security definer set search_path = '' as $$
  select r.* from booking.rooms r
  where r.room_type_id = p_room_type_id
    and r.status <> 'out_of_service'
    and not exists (
      select 1 from booking.bookings b
      where b.room_id = r.id
        and b.status in ('pending_verification', 'confirmed', 'checked_in')
        and (p_exclude_booking is null or b.id <> p_exclude_booking)
        and b.period && tstzrange(p_check_in, p_check_out, '[)')
    )
  order by r.label;
$$;

-- ---- fn_create_booking: optional initial status -----------------------------
-- Adding a parameter changes the signature, so the old overload is dropped
-- first; leaving both would make every call ambiguous.
drop function if exists booking.fn_create_booking(
  text, text, text, uuid, uuid, int, timestamptz, timestamptz,
  booking.booking_source, text
);

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
  p_notes text default null,
  p_status booking.booking_status default 'confirmed'
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
  if p_status not in ('confirmed', 'pending_verification') then
    raise exception 'A new booking must start confirmed or pending verification.';
  end if;

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
          and b.status in ('pending_verification', 'confirmed', 'checked_in')
          and b.period && v_period
      )
    order by r.label
  loop
    begin
      insert into booking.bookings
        (guest_name, guest_phone, guest_email, room_type_id, room_id, rate_tier_id,
         guest_count, period, source, status, quoted_total, notes, created_by)
      values
        (p_guest_name, nullif(p_guest_phone, ''), nullif(p_guest_email, ''),
         p_room_type_id, v_room.id, p_rate_tier_id, p_guest_count, v_period, p_source,
         p_status, v_total, nullif(p_notes, ''), (select auth.uid()))
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
  booking.booking_source, text, booking.booking_status
) to authenticated;
