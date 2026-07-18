-- ============================================================
-- Travelers Inn · Migration 1: booking schema, grants, enums
--
-- Every DB object for this app lives in schema `booking`, never `public`.
-- The Supabase project is SHARED with other apps, so nothing here touches
-- auth.users or registers auth hooks.
-- ============================================================

create schema if not exists booking;

-- API roles need usage; table/function/sequence privileges default-granted.
-- RLS (enabled per table in a later migration) is what actually restricts rows.
grant usage on schema booking to anon, authenticated, service_role;
alter default privileges in schema booking grant all on tables to anon, authenticated, service_role;
alter default privileges in schema booking grant all on routines to anon, authenticated, service_role;
alter default privileges in schema booking grant all on sequences to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------
create type booking.user_role as enum ('admin', 'front_desk');
create type booking.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

-- ------------------------------------------------------------
-- updated_at maintenance
-- ------------------------------------------------------------
create or replace function booking.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
