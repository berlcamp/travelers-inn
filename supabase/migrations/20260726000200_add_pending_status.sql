-- ============================================================
-- Travelers Inn · Migration 12: pending_verification booking status
--
-- MUST stay alone in this file. Postgres cannot use a newly added enum value in
-- the same transaction that added it, and every migration file runs in one
-- transaction — migration 13 references 'pending_verification' in the
-- no_overlap constraint's WHERE clause.
-- ============================================================

alter type booking.booking_status add value if not exists 'pending_verification';
