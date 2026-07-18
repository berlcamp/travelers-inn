-- ============================================================
-- Travelers Inn · Migration 9: fn_available_rooms
--
-- Lists the rooms of a type that are free in a window, optionally ignoring one
-- booking (so a booking being reassigned doesn't count itself as a conflict).
-- Powers the "reassign room" picker.
-- ============================================================

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
        and b.status in ('confirmed', 'checked_in')
        and (p_exclude_booking is null or b.id <> p_exclude_booking)
        and b.period && tstzrange(p_check_in, p_check_out, '[)')
    )
  order by r.label;
$$;

grant execute on function booking.fn_available_rooms(uuid, timestamptz, timestamptz, uuid) to authenticated;
