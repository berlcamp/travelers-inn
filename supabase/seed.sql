-- Travelers Inn · local seed data.
-- The first Google sign-in bootstraps the admin/owner via
-- booking.fn_claim_invitation(). Below we seed the real room types, their rate
-- tiers, rooms, and a few demo bookings so the staff pages have content locally.
-- Guarded with NOT EXISTS so re-runs are safe.

-- ---- Room types (occupancy) --------------------------------------------------
insert into booking.room_types (name, description, base_occupancy, max_occupancy, excess_person_rate)
select t.name, t.description, t.base_occupancy, t.max_occupancy, t.excess_person_rate
from (
  values
    ('Couple Room', 'Snug room for two — day-use blocks or overnight', 2, 2, 0.00),
    ('Travellers Room', 'Good for 4, sleeps up to 6', 4, 6, 350.00),
    ('Family Room', 'Good for 6, sleeps up to 15', 6, 15, 350.00)
) as t(name, description, base_occupancy, max_occupancy, excess_person_rate)
where not exists (select 1 from booking.room_types);

-- ---- Rate tiers --------------------------------------------------------------
insert into booking.rate_tiers (room_type_id, label, kind, duration_hours, price, sort_order)
select rt.id, t.label, t.kind::booking.tier_kind, t.duration_hours, t.price, t.sort_order
from (
  values
    ('Couple Room',    '3 hrs',     'block',     3,    500.00, 0),
    ('Couple Room',    '12 hrs',    'block',     12,   850.00, 1),
    ('Couple Room',    'Overnight', 'overnight', null, 1250.00, 2),
    ('Travellers Room','Overnight', 'overnight', null, 1500.00, 0),
    ('Family Room',    'Overnight', 'overnight', null, 2350.00, 0)
) as t(type_name, label, kind, duration_hours, price, sort_order)
join booking.room_types rt on lower(rt.name) = lower(t.type_name)
where not exists (select 1 from booking.rate_tiers);

-- ---- Rooms -------------------------------------------------------------------
insert into booking.rooms (room_type_id, label, status)
select rt.id, r.label, r.status::booking.room_status
from (
  values
    ('Couple Room', '101', 'vacant'),
    ('Couple Room', '102', 'cleaning'),
    ('Couple Room', '103', 'vacant'),
    ('Travellers Room', '201', 'vacant'),
    ('Travellers Room', '202', 'occupied'),
    ('Travellers Room', '203', 'vacant'),
    ('Family Room', '301', 'vacant'),
    ('Family Room', '302', 'out_of_service')
) as r(type_name, label, status)
join booking.room_types rt on lower(rt.name) = lower(r.type_name)
where not exists (select 1 from booking.rooms);

-- Convenience: the id of a room type's tier by kind/label.
-- (Inlined below since plpgsql-free seeds can't define helpers.)

-- Demo bookings via the real engine (auto-assigns a room, prices from tiers).
do $$
declare
  v_couple uuid := (select id from booking.room_types where lower(name) = 'couple room');
  v_travellers uuid := (select id from booking.room_types where lower(name) = 'travellers room');
  v_family uuid := (select id from booking.room_types where lower(name) = 'family room');
begin
  if not exists (select 1 from booking.bookings) then
    -- Couple, overnight, 2 nights.
    perform booking.fn_create_booking(
      'Maria Santos', '09171234567', 'maria@example.com',
      v_couple,
      (select id from booking.rate_tiers where room_type_id = v_couple and kind = 'overnight'),
      2,
      date_trunc('day', now()) + interval '14 hours',
      date_trunc('day', now()) + interval '2 days 12 hours',
      'staff', null
    );
    -- Couple, 3-hour day-use block.
    perform booking.fn_create_booking(
      'Jose Rizal', '09980000000', null,
      v_couple,
      (select id from booking.rate_tiers where room_type_id = v_couple and label = '3 hrs'),
      2,
      date_trunc('day', now()) + interval '10 hours',
      date_trunc('day', now()) + interval '13 hours',
      'walk_in', null
    );
    -- Family, overnight with excess guests (8 guests, base 6 → 2 excess/night).
    perform booking.fn_create_booking(
      'Andres Bonifacio', null, null,
      v_family,
      (select id from booking.rate_tiers where room_type_id = v_family and kind = 'overnight'),
      8,
      date_trunc('day', now()) + interval '1 day 14 hours',
      date_trunc('day', now()) + interval '3 days 12 hours',
      'portal', null
    );
  end if;
end $$;

-- Demo front-desk state: a partial payment + one checked-in guest.
do $$
declare
  v_b uuid;
  v_couple uuid := (select id from booking.room_types where lower(name) = 'couple room');
begin
  if not exists (select 1 from booking.payments) then
    select id into v_b from booking.bookings where guest_name = 'Maria Santos' limit 1;
    if v_b is not null then
      insert into booking.payments (booking_id, amount, method) values (v_b, 1000, 'cash');
    end if;

    select id into v_b from booking.bookings where guest_name = 'Jose Rizal' limit 1;
    if v_b is not null then
      update booking.bookings set status = 'checked_in' where id = v_b;
      update booking.rooms set status = 'occupied'
        where id = (select room_id from booking.bookings where id = v_b);
    end if;

    -- A completed past stay, paid in full a couple of days ago — gives the
    -- revenue / occupancy trends some history to show.
    v_b := (booking.fn_create_booking(
      'Rosa Delgado', '09990001111', null,
      v_couple,
      (select id from booking.rate_tiers where room_type_id = v_couple and kind = 'overnight'),
      2,
      date_trunc('day', now()) - interval '3 days' + interval '14 hours',
      date_trunc('day', now()) - interval '1 day' + interval '12 hours',
      'walk_in', null
    )).id;
    update booking.bookings set status = 'checked_out' where id = v_b;
    insert into booking.payments (booking_id, amount, method, created_at)
    values (
      v_b,
      (select quoted_total from booking.bookings where id = v_b),
      'cash',
      date_trunc('day', now()) - interval '2 days' + interval '11 hours'
    );
  end if;
end $$;
