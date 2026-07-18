-- Travelers Inn · local seed data.
-- The first Google sign-in bootstraps the admin/owner via
-- booking.fn_claim_invitation(). Below we seed demo room types + rooms so the
-- staff pages have content locally. Guarded with NOT EXISTS so re-runs are safe.

insert into booking.room_types (name, description, capacity, nightly_rate, hourly_rate)
select t.name, t.description, t.capacity, t.nightly_rate, t.hourly_rate
from (
  values
    ('Standard Single', 'Cozy room for solo travelers', 1, 900.00, 150.00),
    ('Standard Double', 'Comfortable room with a queen bed', 2, 1400.00, 220.00),
    ('Deluxe Twin', 'Two single beds, ideal for friends', 2, 1700.00, 260.00),
    ('Family Suite', 'Spacious suite for the whole family', 4, 2600.00, null)
) as t(name, description, capacity, nightly_rate, hourly_rate)
where not exists (select 1 from booking.room_types);

insert into booking.rooms (room_type_id, label, status)
select rt.id, r.label, r.status::booking.room_status
from (
  values
    ('Standard Single', '101', 'vacant'),
    ('Standard Single', '102', 'cleaning'),
    ('Standard Double', '201', 'vacant'),
    ('Standard Double', '202', 'occupied'),
    ('Standard Double', '203', 'vacant'),
    ('Deluxe Twin', '301', 'vacant'),
    ('Deluxe Twin', '302', 'out_of_service'),
    ('Family Suite', '401', 'vacant')
) as r(type_name, label, status)
join booking.room_types rt on lower(rt.name) = lower(r.type_name)
where not exists (select 1 from booking.rooms);

-- Demo bookings via the real engine (auto-assigns a room, prices from rates).
do $$
begin
  if not exists (select 1 from booking.bookings) then
    perform booking.fn_create_booking(
      'Maria Santos', '09171234567', 'maria@example.com',
      (select id from booking.room_types where lower(name) = 'standard double'),
      'nightly',
      date_trunc('day', now()) + interval '14 hours',
      date_trunc('day', now()) + interval '2 days 12 hours',
      'staff', null
    );
    perform booking.fn_create_booking(
      'Jose Rizal', '09980000000', null,
      (select id from booking.room_types where lower(name) = 'standard single'),
      'hourly',
      date_trunc('day', now()) + interval '10 hours',
      date_trunc('day', now()) + interval '13 hours',
      'walk_in', null
    );
    perform booking.fn_create_booking(
      'Andres Bonifacio', null, null,
      (select id from booking.room_types where lower(name) = 'deluxe twin'),
      'nightly',
      date_trunc('day', now()) + interval '1 day 14 hours',
      date_trunc('day', now()) + interval '3 days 12 hours',
      'portal', null
    );
  end if;
end $$;
