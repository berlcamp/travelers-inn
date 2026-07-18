-- ============================================================
-- Travelers Inn · Migration 2: profiles, invitations, user_roles,
--                              audit_logs
--
-- Single-tenant (one inn), so there is no division/tenant key. Access is
-- invite-only: booking.fn_claim_invitation() (migration 3) provisions a
-- profile from `invitations` at sign-in; no profile = no staff access.
-- ============================================================

-- 1:1 with auth.users, provisioned by fn_claim_invitation() at first sign-in.
create table booking.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_key on booking.profiles (lower(email));

-- Admin-managed whitelist. A live (pending, unexpired) invitation lets the
-- matching Google account claim a profile + role on sign-in.
create table booking.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role booking.user_role not null,
  invited_by uuid references auth.users (id) on delete set null,
  status booking.invitation_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live invitation per email at a time.
create unique index invitations_pending_email_key on booking.invitations (lower(email))
  where status = 'pending';

-- Role assignments (a staff member holds one or more roles).
create table booking.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role booking.user_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create index user_roles_user_id_idx on booking.user_roles (user_id);

-- Append-only audit trail (no update/delete policies will be created).
create table booking.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on booking.audit_logs (entity, entity_id);
create index audit_logs_actor_id_idx on booking.audit_logs (actor_id);

create trigger set_updated_at before update on booking.profiles
  for each row execute function booking.set_updated_at();
create trigger set_updated_at before update on booking.invitations
  for each row execute function booking.set_updated_at();
