-- ============================================================
-- Travelers Inn · Migration 16: revoke anon EXECUTE on internal functions
--
-- Migration 1's `alter default privileges in schema booking grant all on
-- routines to anon, authenticated, service_role` handed every function
-- created since then -- including the booking engine itself -- a live
-- EXECUTE grant for the public anon key. That means anyone holding the anon
-- key (it is public, shipped to the browser) could call fn_create_booking
-- and friends directly over PostgREST / `supabase.rpc(...)`, bypassing every
-- server-action guard: the portal's future-date/max-nights checks, the
-- deposit-verification pending status, staff role checks -- all of it.
-- fn_create_booking is the serious one: anon could create a fully
-- 'confirmed' booking (p_status defaults to 'confirmed') with no deposit and
-- no proof of payment.
--
-- This migration locks each already-shipped function down to only the
-- Postgres roles that legitimately call it, worked out from how the app and
-- its DB tests actually invoke them (grepped, not guessed):
--
--   fn_create_booking, fn_count_available
--     - staff walk-in / front-desk flows call these via the RLS-scoped
--       server client (src/lib/supabase/server.ts), i.e. as `authenticated`
--       (src/features/bookings/actions.ts).
--     - the public portal calls both via the admin/service_role client
--       (src/features/portal/actions.ts, repository.ts) -- anon itself never
--       calls them; the server action does, server-side, with its own
--       future-date/max-nights/status guards already applied.
--     Grant: authenticated, service_role. Revoke: anon, public.
--
--   fn_available_rooms
--     - the staff reassign-room dialog calls it via the RLS-scoped server
--       client (src/features/bookings/repository.ts), i.e. as
--       `authenticated`. No admin/service_role caller exists in the app
--       today, but the DB test suite (supabase/tests/verification.test.mjs)
--       exercises this function's semantics through the service_role client
--       and must keep passing -- service_role is the trusted server-only key
--       (never shipped to a browser), so granting it here costs nothing
--       security-wise; the boundary this migration protects is anon.
--     Grant: authenticated, service_role. Revoke: anon, public.
--
--   fn_claim_invitation
--     - only ever called immediately after a user completes OAuth sign-in,
--       via the RLS-scoped client (src/app/auth/callback/route.ts,
--       src/lib/supabase/middleware.ts), i.e. as `authenticated`. Never
--       called from the admin client.
--     Grant: authenticated. Revoke: anon, service_role, public.
--
-- None of these are ever legitimately called by `anon`.
-- ============================================================

revoke execute on function booking.fn_create_booking(
  text, text, text, uuid, uuid, integer, timestamptz, timestamptz,
  booking.booking_source, text, booking.booking_status
) from public, anon;
grant execute on function booking.fn_create_booking(
  text, text, text, uuid, uuid, integer, timestamptz, timestamptz,
  booking.booking_source, text, booking.booking_status
) to authenticated, service_role;

revoke execute on function booking.fn_count_available(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function booking.fn_count_available(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

revoke execute on function booking.fn_available_rooms(uuid, timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function booking.fn_available_rooms(uuid, timestamptz, timestamptz, uuid)
  to authenticated, service_role;

revoke execute on function booking.fn_claim_invitation()
  from public, anon, service_role;
grant execute on function booking.fn_claim_invitation()
  to authenticated;

-- The five revokes above only fix the functions that exist today. Migration
-- 1's `alter default privileges ... grant all on routines to anon, ...` is
-- still in force, so any *future* function -- and any existing function that
-- gains/loses a parameter, which mints a new function object under Postgres
-- overload rules -- silently re-acquires the anon grant on creation. That is
-- exactly how fn_create_booking regained EXECUTE on this branch when its
-- signature grew a trailing p_status parameter. This line undoes migration
-- 1's schema-scoped default grant to `anon` (and, for hygiene, `public`) so a
-- brand-new function created with no other privilege statement no longer
-- inherits it from that record.
alter default privileges in schema booking revoke execute on routines from public, anon;

-- IMPORTANT LIMITATION, confirmed by testing against this local stack (create
-- a throwaway function in `booking` after this migration, then check
-- has_function_privilege('anon', ..., 'EXECUTE')): the line above does NOT
-- make new functions anon-safe by itself. PostgreSQL grants EXECUTE on every
-- newly created function to the PUBLIC pseudo-role unconditionally at
-- CREATE FUNCTION time, and this is a *global*, not schema-scoped, built-in
-- default -- a schema-scoped `alter default privileges ... revoke ... from
-- public` cannot undo it (long-standing Postgres behavior/limitation, e.g.
-- postgresql.org bug #8685). Every role, `anon` included, is implicitly a
-- member of PUBLIC, so `anon` still gets EXECUTE on any *new* function in
-- this schema regardless of this statement. A database-wide (no `in schema`)
-- revoke would close it, but that reaches every schema the migrating role
-- touches on this SHARED Supabase project (other apps' functions too) and is
-- out of scope for a booking-only migration.
--
-- The only mechanism that reliably keeps a new SECURITY DEFINER function off
-- the anon/public grant is an explicit `revoke execute on function
-- booking.fn_x(...) from public, anon;` immediately after its `create
-- function`, exactly like the five revokes above and like
-- 20260726000400_feedback.sql already does for fn_submit_feedback. Any
-- future migration that adds a routine not meant for anon/public MUST do
-- the same -- do not rely on this default-privilege statement alone.
