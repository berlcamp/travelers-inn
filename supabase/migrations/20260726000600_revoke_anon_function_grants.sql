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
