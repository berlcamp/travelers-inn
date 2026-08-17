-- ============================================================
-- Travelers Inn · Migration 21: only an administrator may DELETE a booking
--
-- `bookings_staff_write` (migration 6) is `for all`, and `for all` includes
-- DELETE — so every active staff member could already erase a booking, its
-- payments and its proofs with a single REST call. Nothing in the app offered
-- it, which is exactly why it went unnoticed: the permission existed and the
-- product didn't. Deleting is a real feature now (admin only, from the booking
-- manage dialog), so the policy has to name who may do it rather than leaving
-- that to a hidden button.
--
-- Split into per-command policies:
--   INSERT / UPDATE — any active staff member. Unchanged behaviour, just
--                     spelled out instead of riding on `for all`.
--   DELETE          — admin, and only while their profile is active. A
--                     deactivated admin holding a still-valid JWT is refused
--                     here as well as by proxy.ts. (fn_is_admin() alone does
--                     not check is_active — see migration 3.)
-- SELECT is untouched: `bookings_staff_read` already grants it, and dropping
-- the `for all` policy takes nothing away from it.
--
-- What a delete takes with it: `payments` and `booking_proofs` both reference
-- the booking `on delete cascade`, so the money and the proof rows go too.
-- Those cascades need no policy of their own — referential-integrity actions
-- bypass RLS by design. `audit_logs.entity_id` is a plain uuid with NO foreign
-- key, so the trail survives the booking it describes, including the
-- `booking.delete` entry the server action writes with a snapshot of the row.
-- The storage OBJECT behind a proof is reached by no cascade at all; the
-- action deletes it explicitly (ti_proofs_admin_delete, migration 13).
--
-- No new function here, so no `revoke execute … from public, anon` is needed
-- (see 20260726000600) — policies carry no grant.
-- ============================================================

drop policy if exists bookings_staff_write on booking.bookings;

do $$ begin
  create policy bookings_staff_insert on booking.bookings for insert
    with check (booking.fn_is_active_user());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy bookings_staff_update on booking.bookings for update
    using (booking.fn_is_active_user())
    with check (booking.fn_is_active_user());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy bookings_admin_delete on booking.bookings for delete
    using (booking.fn_is_admin() and booking.fn_is_active_user());
exception when duplicate_object then null; end $$;
