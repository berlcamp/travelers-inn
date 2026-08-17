-- ============================================================================
-- ONE-OFF DATA FIX — bookings written by the UTC server before the inn-clock fix
--
-- NOT a migration. It lives here, not in supabase/migrations/, on purpose: it
-- describes damage done to ONE database over one period of time. Run against a
-- fresh local stack it would corrupt correct data, which is exactly what a
-- migration would eventually do.
--
-- WHAT HAPPENED
--   Until src/lib/inn-time.ts, wall-clock strings from the forms ("2026-08-17
--   T20:17") were parsed with `new Date(...)`, which reads a zoneless string in
--   the PROCESS's timezone. On a dev laptop that is Asia/Manila and the result
--   was right. On the deployed server it is UTC, so "8:17 PM" was stored as
--   20:17Z = 4:17 AM the next day in Manila. Every booking created through the
--   deployed site carries a `period` shifted EIGHT HOURS LATE — both ends.
--
--   Money is NOT affected: `payments.created_at` is `now()`, an absolute
--   instant, and `quoted_total` was computed from the same shifted window at
--   both ends, so the night count and the price are what the guest agreed to.
--   Only the stay WINDOW is wrong. (That still matters: it decides who the
--   dashboard calls an arrival, what the calendar paints, and which room the
--   exclusion constraint protects.)
--
-- BEFORE YOU RUN ANYTHING
--   Deploy the code fix first. Correcting the data while the old code is still
--   live just produces a new batch of shifted rows behind you.
--
-- HOW TO USE THIS FILE
--   Run STEP 1 and read it. Run STEP 2 and read it. Only then run STEP 3, and
--   run it inside the transaction as written so you can ROLLBACK.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 — What is in there? Read the windows on the inn's clock.
--
-- `looks_shifted` is a FINGERPRINT, not proof. It keys off the house rules the
-- app enforces: an overnight stay is always due out at 12:00 noon Manila, and
-- the walk-in/portal forms default arrival to 13:00 or 14:00. If a row's
-- check-out reads 20:00 instead of 12:00, it was written eight hours late.
-- Bookings you made from `npm run dev` on your own machine are correct and
-- will show `false` — that is the whole reason for looking before updating.
-- ---------------------------------------------------------------------------

set time zone 'Asia/Manila';

select
  b.reference_code,
  b.source,
  b.status,
  rt.kind                                        as rate_kind,
  lower(b.period)                                as check_in_manila,
  upper(b.period)                                as check_out_manila,
  lower(b.period) - interval '8 hours'           as check_in_if_fixed,
  upper(b.period) - interval '8 hours'           as check_out_if_fixed,
  -- An overnight stay that is not due out at noon was not written on the
  -- inn's clock. 20:00 is exactly noon + 8h.
  (rt.kind = 'overnight' and extract(hour from upper(b.period)) = 20)
                                                 as looks_shifted,
  b.created_at
from booking.bookings b
join booking.rate_tiers rt on rt.id = b.rate_tier_id
order by b.created_at;


-- ---------------------------------------------------------------------------
-- STEP 2 — The rows STEP 3 would change, and the ones it deliberately won't.
--
-- Two populations need different treatment:
--
--   A. Ordinary rows — both ends came from the shifted parse, so both ends move.
--
--   B. Rows already checked out — `checkOut` (features/bookings/front-desk-
--      actions.ts) overwrote `upper(period)` with `new Date()`, an ABSOLUTE
--      instant, which was always correct even on the UTC server. Their check-in
--      is shifted but their check-out is not, so moving both ends would break a
--      time that is currently right. Only the lower bound moves.
--
-- If this returns rows you did NOT expect (a booking you know was made from a
-- laptop), stop and narrow STEP 3 to an explicit list of reference codes.
-- ---------------------------------------------------------------------------

select
  case
    when b.status = 'checked_out'
     and exists (
           select 1 from booking.audit_logs a
           where a.entity = 'booking'
             and a.entity_id = b.id::text
             and a.action = 'booking.check_out'
             and a.diff ? 'actual_check_out'
         )
    then 'B — check-in only (real check-out already correct)'
    else 'A — whole window'
  end                                            as treatment,
  count(*)                                       as bookings
from booking.bookings b
join booking.rate_tiers rt on rt.id = b.rate_tier_id
where rt.kind = 'overnight'
  and extract(hour from upper(b.period)) = 20
group by 1;


-- ---------------------------------------------------------------------------
-- STEP 3 — Apply. Wrapped in a transaction: run it, re-run STEP 1, and only
-- then COMMIT. If anything looks wrong, ROLLBACK and nothing happened.
--
-- The exclusion constraint `no_overlap` is still live during this. That is
-- deliberate — if shifting a room's bookings would double-book it, this must
-- FAIL rather than quietly produce two guests in one room. Every affected row
-- moves by the same -8h, so their order among themselves is preserved; a
-- failure means a shifted row would collide with a CORRECT one, which is a
-- real conflict a human has to resolve.
--
-- Idempotent by construction: after the update an overnight check-out reads
-- 12:00, so the `= 20` fingerprint no longer matches and a second run is a
-- no-op. Do not remove that predicate.
-- ---------------------------------------------------------------------------

begin;

-- B first — check-in only, for stays whose real departure was already stamped.
update booking.bookings b
set period = tstzrange(
      lower(b.period) - interval '8 hours',
      upper(b.period),
      '[)'
    )
from booking.rate_tiers rt
where rt.id = b.rate_tier_id
  and rt.kind = 'overnight'
  and extract(hour from upper(b.period)) = 20
  and b.status = 'checked_out'
  and exists (
        select 1 from booking.audit_logs a
        where a.entity = 'booking'
          and a.entity_id = b.id::text
          and a.action = 'booking.check_out'
          and a.diff ? 'actual_check_out'
      )
  -- An 8-hour-earlier check-in must still precede the recorded check-out, or
  -- the range is empty and `bookings_period_valid` rejects it.
  and lower(b.period) - interval '8 hours' < upper(b.period);

-- A — everything else the fingerprint matched.
update booking.bookings b
set period = tstzrange(
      lower(b.period) - interval '8 hours',
      upper(b.period) - interval '8 hours',
      '[)'
    )
from booking.rate_tiers rt
where rt.id = b.rate_tier_id
  and rt.kind = 'overnight'
  and extract(hour from upper(b.period)) = 20;

-- Re-run STEP 1 here in the same session and read the windows.
-- Then: COMMIT;   (or ROLLBACK; to abandon the whole thing)


-- ============================================================================
-- BLOCK (hourly) BOOKINGS — read this before assuming they are done.
--
-- The fingerprint above only covers `kind = 'overnight'`, because only those
-- have a fixed hour the app guarantees. A 3-hour block's check-out is just
-- check-in + 3h, so nothing about the stored row says which clock wrote it:
-- "20:17 → 23:17" is a perfectly ordinary booking and also exactly what a
-- 12:17 → 15:17 booking looks like after an eight-hour shift.
--
-- So block bookings must be corrected BY HAND, from what the guest was told.
-- List them with STEP 1, decide which are yours, and shift them by reference
-- code:
--
--   update booking.bookings
--   set period = tstzrange(lower(period) - interval '8 hours',
--                          upper(period) - interval '8 hours', '[)')
--   where reference_code in ('TI-000123', 'TI-000124');
--
-- There is no automated version of this that is safe, and guessing would put
-- guests in the wrong room at the wrong hour. If the inn has few block
-- bookings so far, doing it by hand is a five-minute job; if it has many, run
-- STEP 1 filtered to `rt.kind = 'block'` and work down the list by created_at
-- — everything created through the website is shifted, everything created
-- while testing from a laptop is not.
-- ============================================================================
