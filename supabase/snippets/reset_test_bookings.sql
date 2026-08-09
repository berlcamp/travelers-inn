-- ============================================================
-- Travelers Inn · Reset TEST BOOKING DATA (production, post-UAT)
--
-- NOT a migration. Do not put this in supabase/migrations/. Run it once by
-- hand in the Supabase SQL editor (it runs as `postgres`, so RLS does not
-- get in the way).
--
-- WIPES (transactional data only):
--   booking.payments          every recorded payment
--   booking.booking_proofs    deposit proof rows for portal bookings
--   booking.bookings          every booking, any status, any channel
--   booking.feedback          guest QR feedback (optional block — see § 4)
--   booking.audit_logs        ONLY rows with entity = 'booking'
--   booking.rooms.status      occupied/cleaning -> vacant (housekeeping reset)
-- Proof FILES in storage are a manual dashboard step — see § 6.
--
-- KEEPS (configuration + identity — nothing below is touched):
--   room_types, rate_tiers, room_type_photos, rooms (the rows themselves),
--   profiles, user_roles, invitations, settings,
--   audit_logs for room / room_type / settings / profile / invitation,
--   the public room-photo storage bucket.
--
-- DRY RUN: run § 0 first. To rehearse the whole thing, change the final
-- COMMIT to ROLLBACK, run it, read the counts, then change it back.
-- ============================================================


-- ------------------------------------------------------------
-- § 0 · BEFORE — what is about to go (run this on its own first)
-- ------------------------------------------------------------
select 'bookings'        as table_name, count(*) from booking.bookings
union all select 'payments',            count(*) from booking.payments
union all select 'booking_proofs',      count(*) from booking.booking_proofs
union all select 'feedback',            count(*) from booking.feedback
union all select 'audit_logs (booking)',count(*) from booking.audit_logs where entity = 'booking'
union all select 'proof files',         count(*) from storage.objects
         where bucket_id = 'travelers-inn-payment-proofs'
union all select 'rooms occupied/cleaning', count(*) from booking.rooms
         where status in ('occupied', 'cleaning')
-- untouched, shown so you can confirm they survive:
union all select 'KEEP room_types',     count(*) from booking.room_types
union all select 'KEEP rooms',          count(*) from booking.rooms
union all select 'KEEP rate_tiers',     count(*) from booking.rate_tiers
union all select 'KEEP profiles',       count(*) from booking.profiles
union all select 'KEEP settings',       count(*) from booking.settings;


-- ============================================================
-- THE RESET
-- ============================================================
begin;

-- ------------------------------------------------------------
-- § 1 · Payments — delete BEFORE bookings, on purpose.
-- payments.booking_id is ON DELETE CASCADE, so dropping bookings first would
-- fire the sync_payment_status trigger once per cascaded payment, each firing
-- an UPDATE against the booking row that same statement is deleting. Clearing
-- the ledger first makes that trigger work on rows that still exist.
-- ------------------------------------------------------------
delete from booking.payments;

-- ------------------------------------------------------------
-- § 2 · Deposit proofs (portal bookings). Rows first, files in § 6.
-- ------------------------------------------------------------
delete from booking.booking_proofs;

-- ------------------------------------------------------------
-- § 3 · The bookings themselves — every status, every channel.
-- room_id / room_type_id are ON DELETE RESTRICT, i.e. bookings point AT rooms,
-- never the other way round: deleting bookings cannot reach the inventory.
-- ------------------------------------------------------------
delete from booking.bookings;

-- ------------------------------------------------------------
-- § 4 · Guest feedback (OPTIONAL — comment out the line to keep it).
-- feedback hangs off rooms, not bookings, so it does not go with § 3. If you
-- scanned the QR cards while testing, these are test rows too.
-- ------------------------------------------------------------
delete from booking.feedback;

-- ------------------------------------------------------------
-- § 5 · Audit trail for those bookings only.
-- Every booking action (create, check-in/out, no-show, cancel, payment.record,
-- deposit verify/reject, room reassign) logs entity = 'booking'. Room,
-- room_type, settings, profile and invitation entries are left alone, so the
-- history of how the inn was CONFIGURED survives.
-- ------------------------------------------------------------
delete from booking.audit_logs where entity = 'booking';

-- ------------------------------------------------------------
-- § 6 · Proof FILES — deliberately not done in SQL.
--
-- `delete from storage.objects` is refused by Supabase itself:
--   ERROR: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead.
-- (storage.protect_delete(), verified against this project's stack — the
-- statement was in an earlier draft of this script and aborted the whole
-- transaction.) Deleting rows there would orphan the S3 blobs anyway.
--
-- The app is already clean without it: proofs are only ever reached through
-- booking.booking_proofs, emptied in § 2, so nothing links to these files.
-- To reclaim the storage too, do it by hand after this script:
--   Dashboard → Storage → travelers-inn-payment-proofs → select all → Delete.
-- Leave the PUBLIC room-photo bucket alone — those are live room covers.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- § 7 · Housekeeping reset. Test check-ins set rooms to 'occupied' and
-- check-outs to 'cleaning'; with no bookings left those are lies.
-- 'out_of_service' is deliberately NOT reset — that is a real maintenance
-- decision a staff member made, not test residue.
-- ------------------------------------------------------------
update booking.rooms
   set status = 'vacant'
 where status in ('occupied', 'cleaning');

commit;   -- <-- swap for ROLLBACK to rehearse without writing


-- ------------------------------------------------------------
-- § 8 · AFTER — the first five must be 0, the KEEP rows unchanged.
-- ------------------------------------------------------------
select 'bookings'        as table_name, count(*) from booking.bookings
union all select 'payments',            count(*) from booking.payments
union all select 'booking_proofs',      count(*) from booking.booking_proofs
union all select 'feedback',            count(*) from booking.feedback
union all select 'audit_logs (booking)',count(*) from booking.audit_logs where entity = 'booking'
union all select 'KEEP room_types',     count(*) from booking.room_types
union all select 'KEEP rooms',          count(*) from booking.rooms
union all select 'KEEP rate_tiers',     count(*) from booking.rate_tiers
union all select 'KEEP profiles',       count(*) from booking.profiles
union all select 'KEEP settings',       count(*) from booking.settings;
