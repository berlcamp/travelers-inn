-- ============================================================
-- Travelers Inn · Optional specific-room assignment at booking time
--
-- Until now fn_create_booking always chose the room: it walked the free rooms
-- of the type in label order and took the first that won the race. That stays
-- the default, because it is race-safe by construction and keeps the walk-in
-- flow to three decisions (type, rate, guests).
--
-- What it could not do is honour "the ground-floor one, please" — a request the
-- desk gets all day. The only way to serve it was to book, then reassign from
-- the manage dialog: two writes, two audit entries, and a moment where the
-- guest has been told a room number that is about to change.
--
-- p_room_id is therefore an OVERRIDE, not a new required field. Null keeps the
-- old loop verbatim. Supplied, the room is validated and inserted directly, so
-- a caller who names a taken room is told so rather than being silently moved
-- to a different one — silently honouring the type but not the room is the one
-- outcome that would make this feature worse than useless.
--
-- The portal deliberately does not pass it: a guest picking "205" builds an
-- expectation housekeeping may have to break, and exposes the floor plan to
-- anyone probing the form.
-- ============================================================

-- Adding a parameter changes the signature, so the old overload is dropped
-- first; leaving both would make every call ambiguous.
drop function if exists booking.fn_create_booking(
  text, text, text, uuid, uuid, int, timestamptz, timestamptz,
  booking.booking_source, text, booking.booking_status
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
  p_status booking.booking_status default 'confirmed',
  p_room_id uuid default null
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
  v_picked booking.rooms;
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

  -- Validate the named room BEFORE pricing, so a bad room id fails on its own
  -- terms rather than as a surprise at insert time.
  if p_room_id is not null then
    select * into v_picked from booking.rooms where id = p_room_id;
    if v_picked.id is null then
      raise exception 'That room does not exist.';
    end if;
    if v_picked.room_type_id <> p_room_type_id then
      raise exception 'Room % is not of the selected room type.', v_picked.label;
    end if;
    if v_picked.status = 'out_of_service' then
      raise exception 'Room % is out of service.', v_picked.label;
    end if;
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

  -- Named room: one attempt, and losing the race is an error rather than a
  -- fallback. The exclusion constraint is still what decides, so this is as
  -- race-safe as the loop below — it just reports instead of substituting.
  if p_room_id is not null then
    begin
      insert into booking.bookings
        (guest_name, guest_phone, guest_email, room_type_id, room_id, rate_tier_id,
         guest_count, period, source, status, quoted_total, notes, created_by)
      values
        (p_guest_name, nullif(p_guest_phone, ''), nullif(p_guest_email, ''),
         p_room_type_id, p_room_id, p_rate_tier_id, p_guest_count, v_period, p_source,
         p_status, v_total, nullif(p_notes, ''), (select auth.uid()))
      returning * into v_booking;
      return v_booking;
    exception when exclusion_violation then
      raise exception 'Room % is already booked for those dates.', v_picked.label;
    end;
  end if;

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

-- MANDATORY for every new or re-signatured function in this schema. Migration
-- 1's `alter default privileges ... grant all on routines to anon` is still in
-- force, and Postgres grants EXECUTE to PUBLIC at CREATE FUNCTION time
-- regardless of any schema-scoped revoke — so the parameter added above has
-- just minted a brand-new function object carrying a live anon grant. See
-- 20260726000600 for why a schema-scoped revoke cannot prevent this.
revoke execute on function booking.fn_create_booking(
  text, text, text, uuid, uuid, integer, timestamptz, timestamptz,
  booking.booking_source, text, booking.booking_status, uuid
) from public, anon;
grant execute on function booking.fn_create_booking(
  text, text, text, uuid, uuid, integer, timestamptz, timestamptz,
  booking.booking_source, text, booking.booking_status, uuid
) to authenticated, service_role;
