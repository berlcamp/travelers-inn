-- ============================================================
-- Travelers Inn · Migration 18: booking staff attribution + activity trail
--
-- Who took the walk-in, who verified the deposit, who received each payment.
-- Two of those three were already recorded — `bookings.created_by` (set by
-- fn_create_booking from auth.uid()) and `payments.recorded_by` — but nothing
-- surfaced them, and the verifier was only ever written to audit_logs.
--
-- audit_logs is a best-effort trail (logAudit deliberately swallows its own
-- errors so a failed log never breaks a booking), so attribution the business
-- actually reports on gets first-class columns instead: verified_by/verified_at
-- are written in the SAME conditional UPDATE that confirms the booking, which
-- makes them exactly as race-safe as the status flip itself.
--
-- Reading the trail needs two things RLS deliberately withholds from
-- front_desk: audit_logs (admin-only) and other people's profiles (self-only).
-- Rather than widen either policy — audit_logs also carries settings and role
-- changes, and profiles carry emails — this adds two narrow SECURITY DEFINER
-- readers: one returns the trail for ONE booking, the other resolves staff
-- ids to names ONLY. Both refuse anyone who isn't active staff.
--
-- Per migration 20260726000600: every new function needs its own explicit
-- revoke from public/anon, because CREATE FUNCTION grants EXECUTE to PUBLIC
-- unconditionally and a schema-scoped default-privileges revoke cannot
-- override that.
-- ============================================================

-- ---- who verified the deposit ----------------------------------------------
alter table booking.bookings
  add column if not exists verified_by uuid references auth.users (id) on delete set null;
alter table booking.bookings
  add column if not exists verified_at timestamptz;

comment on column booking.bookings.verified_by is
  'Staff member who verified the deposit and confirmed a portal booking. Null for walk-ins, which are confirmed by whoever created them (see created_by).';

-- Reports group by these, and both columns are sparse (only portal bookings
-- carry a verifier), so a partial index keeps it small.
create index if not exists bookings_verified_by_idx
  on booking.bookings (verified_by) where verified_by is not null;
create index if not exists bookings_created_by_idx
  on booking.bookings (created_by) where created_by is not null;
create index if not exists payments_recorded_by_idx on booking.payments (recorded_by);
create index if not exists payments_created_at_idx on booking.payments (created_at);

-- ---- staff name lookup ------------------------------------------------------
-- Names only — never email, is_active, or anything else on the profile. Front
-- desk needs to read "checked in by Dana Desk" without gaining the ability to
-- list colleagues' contact details.
create or replace function booking.fn_staff_names(p_ids uuid[])
returns table (staff_id uuid, staff_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
  from booking.profiles p
  where booking.fn_is_active_user()
    and p.id = any(p_ids);
$$;

revoke execute on function booking.fn_staff_names(uuid[]) from public, anon;
grant execute on function booking.fn_staff_names(uuid[]) to authenticated;

-- ---- per-booking activity trail ---------------------------------------------
-- Scoped to ONE booking's audit rows, with the actor's name already joined.
-- audit_logs itself stays admin-only: this cannot reach settings, invitation,
-- user, or room_type entries.
create or replace function booking.fn_booking_trail(p_booking_id uuid)
returns table (
  entry_id uuid,
  action text,
  actor_id uuid,
  actor_name text,
  diff jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.action, a.actor_id, p.full_name, a.diff, a.created_at
  from booking.audit_logs a
  left join booking.profiles p on p.id = a.actor_id
  where booking.fn_is_active_user()
    and a.entity = 'booking'
    and a.entity_id = p_booking_id::text
  order by a.created_at;
$$;

revoke execute on function booking.fn_booking_trail(uuid) from public, anon;
grant execute on function booking.fn_booking_trail(uuid) to authenticated;
