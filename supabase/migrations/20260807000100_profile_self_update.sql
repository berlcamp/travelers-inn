-- ============================================================
-- Travelers Inn · Let a staff member edit their own display name.
--
-- `booking.profiles` deliberately has no self-update policy — the only UPDATE
-- policy is `profiles_admin_update` (migration 4). That is not an oversight
-- to correct by widening it: a row-level policy grants the whole ROW, and two
-- of this row's columns are emphatically not the subject's to set.
--
--   * `is_active` is the deactivation flag. `proxy.ts` bounces a deactivated
--     profile to /login, and features/users/actions.ts is the only thing meant
--     to flip it. A self-update policy would let a deactivated-by-an-admin
--     user reactivate themselves — the whole staff-management milestone
--     undone by one UPDATE.
--   * `email` is the identity key: `fn_claim_invitation` matches an
--     invitation on it, and `profiles_email_key` is unique on lower(email).
--     Letting someone rewrite it detaches their profile from the invitation
--     that authorised it.
--
-- Postgres RLS has no column-level WITH CHECK, so the write is a function
-- rather than a policy. It touches one column, on one row, chosen by
-- `auth.uid()` and never by an argument — there is no id parameter to forge.
-- `profiles` RLS is left exactly as it was.
-- ============================================================

create or replace function booking.fn_update_my_profile(p_full_name text)
returns booking.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
  v_row booking.profiles;
begin
  -- Active staff only. A signed-in JWT is not enough: a deactivated user's
  -- session survives until it expires, and they should not be editing rows.
  if not booking.fn_is_active_user() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;

  if length(v_name) > 120 then
    raise exception 'Name is too long' using errcode = '22001';
  end if;

  update booking.profiles
     set full_name = v_name,
         updated_at = now()
   where id = (select auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- Mandatory for every new SECURITY DEFINER function in this schema — see the
-- long note in 20260726000600_revoke_anon_function_grants.sql. Postgres grants
-- EXECUTE to PUBLIC (which `anon` inherits) at CREATE FUNCTION time, and the
-- schema-scoped default-privilege revoke cannot undo that.
revoke execute on function booking.fn_update_my_profile(text) from public, anon;
grant execute on function booking.fn_update_my_profile(text) to authenticated;
