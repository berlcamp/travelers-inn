-- ============================================================
-- Travelers Inn · Migration 3: RLS helper functions + invitation
--                              claim (invite-only gate)
--
-- The Supabase project is SHARED (shared auth.users), so this app registers
-- NO auth hooks and NO triggers on auth.users. The invite gate works entirely
-- through booking.profiles:
--   * fn_claim_invitation() provisions a profile + role only when a live
--     invitation exists (or, for the very first user, bootstraps an admin).
--   * Users without an active booking.profiles row are signed out by the app
--     (scope: local, so other apps' sessions are untouched).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- RLS helpers — SECURITY DEFINER so policies never recurse into
-- user_roles' own policies. Owned by postgres (bypasses RLS).
-- ------------------------------------------------------------
create or replace function booking.fn_has_role(p_role booking.user_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from booking.user_roles
    where user_id = (select auth.uid()) and role = p_role
  );
$$;

create or replace function booking.fn_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from booking.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function booking.fn_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from booking.profiles
    where id = (select auth.uid()) and is_active
  );
$$;

-- ------------------------------------------------------------
-- Invitation claim: provisions the signed-in user's profile and role
-- when a live invitation matches their email. Bootstrap: the very first
-- user (empty profiles table) with no invitation becomes the admin/owner.
-- Idempotent; returns true when the user has a profile after the call.
-- ------------------------------------------------------------
create or replace function booking.fn_claim_invitation()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_name text;
  v_avatar text;
  v_inv record;
  v_role booking.user_role;
begin
  if v_uid is null then
    return false;
  end if;

  -- Already provisioned.
  if exists (select 1 from booking.profiles where id = v_uid) then
    return true;
  end if;

  select
    lower(u.email),
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.email),
    coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
  into v_email, v_name, v_avatar
  from auth.users u
  where u.id = v_uid;

  select id, role into v_inv
  from booking.invitations
  where lower(email) = v_email
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  if v_inv.id is not null then
    v_role := v_inv.role;
  elsif not exists (select 1 from booking.profiles) then
    -- Owner bootstrap: first ever user with no invitation becomes admin.
    v_role := 'admin';
  else
    -- No invitation and not the first user → no access.
    return false;
  end if;

  insert into booking.profiles (id, email, full_name, avatar_url)
  values (v_uid, v_email, v_name, v_avatar)
  on conflict (id) do nothing;

  insert into booking.user_roles (user_id, role)
  values (v_uid, v_role)
  on conflict do nothing;

  if v_inv.id is not null then
    update booking.invitations
    set status = 'accepted', accepted_at = now()
    where id = v_inv.id;
  end if;

  return true;
end;
$$;
