-- ============================================================
-- Travelers Inn · Migration 4: RLS policies for identity tables
--
-- Every staff-facing table gets RLS. Helpers from migration 3 are
-- SECURITY DEFINER, so policies referencing them never recurse.
-- ============================================================

alter table booking.profiles enable row level security;
alter table booking.user_roles enable row level security;
alter table booking.invitations enable row level security;
alter table booking.audit_logs enable row level security;

-- profiles: a user reads their own row; admins read all and manage.
create policy profiles_self_read on booking.profiles for select
  using (id = (select auth.uid()) or booking.fn_is_admin());
create policy profiles_admin_update on booking.profiles for update
  using (booking.fn_is_admin())
  with check (booking.fn_is_admin());

-- user_roles: a user reads their own roles; admins manage all.
create policy roles_self_read on booking.user_roles for select
  using (user_id = (select auth.uid()) or booking.fn_is_admin());
create policy roles_admin_all on booking.user_roles for all
  using (booking.fn_is_admin())
  with check (booking.fn_is_admin());

-- invitations: admin-only.
create policy invites_admin_all on booking.invitations for all
  using (booking.fn_is_admin())
  with check (booking.fn_is_admin());

-- audit_logs: append-only for any authenticated actor; admins read.
create policy audit_insert on booking.audit_logs for insert to authenticated
  with check (true);
create policy audit_read on booking.audit_logs for select
  using (booking.fn_is_admin());
