-- ============================================================
-- Travelers Inn · Migration 7: booking availability + creation functions
--
-- fn_create_booking auto-assigns the first free room of a type and inserts
-- atomically, computing the price authoritatively from the type's rates (never
-- trusting the caller). It retries across rooms on the exclusion-constraint
-- race, so concurrent requests for the last room resolve cleanly. Both are
-- SECURITY DEFINER so the M5 portal can reuse them.
-- ============================================================

-- Rooms of a type with no overlapping active booking in the window.
create or replace function booking.fn_count_available(
  p_room_type_id uuid, p_check_in timestamptz, p_check_out timestamptz
) returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from booking.rooms r
  where r.room_type_id = p_room_type_id
    and r.status <> 'out_of_service'
    and not exists (
      select 1 from booking.bookings b
      where b.room_id = r.id
        and b.status in ('confirmed', 'checked_in')
        and b.period && tstzrange(p_check_in, p_check_out, '[)')
    );
$$;

create or replace function booking.fn_create_booking(
  p_guest_name text,
  p_guest_phone text,
  p_guest_email text,
  p_room_type_id uuid,
  p_stay_type booking.stay_type,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_source booking.booking_source,
  p_notes text default null
) returns booking.bookings language plpgsql security definer set search_path = '' as $$
declare
  v_type booking.room_types;
  v_period tstzrange;
  v_units int;
  v_total numeric(10,2);
  v_room record;
  v_booking booking.bookings;
begin
  -- Validate before constructing the range: tstzrange() itself throws on an
  -- inverted window, which would pre-empt this friendly message.
  if p_check_out <= p_check_in then
    raise exception 'Check-out must be after check-in.';
  end if;
  v_period := tstzrange(p_check_in, p_check_out, '[)');

  select * into v_type from booking.room_types where id = p_room_type_id and is_active;
  if v_type.id is null then
    raise exception 'That room type is not bookable.';
  end if;

  if p_stay_type = 'nightly' then
    v_units := greatest(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 86400.0)::int);
    v_total := v_units * v_type.nightly_rate;
  else
    if v_type.hourly_rate is null then
      raise exception 'This room type has no hourly rate.';
    end if;
    v_units := greatest(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 3600.0)::int);
    v_total := v_units * v_type.hourly_rate;
  end if;

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
        (guest_name, guest_phone, guest_email, room_type_id, room_id, stay_type,
         period, source, quoted_total, notes, created_by)
      values
        (p_guest_name, nullif(p_guest_phone, ''), nullif(p_guest_email, ''),
         p_room_type_id, v_room.id, p_stay_type, v_period, p_source, v_total,
         nullif(p_notes, ''), (select auth.uid()))
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

grant execute on function booking.fn_count_available(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function booking.fn_create_booking(
  text, text, text, uuid, booking.stay_type, timestamptz, timestamptz, booking.booking_source, text
) to authenticated;
