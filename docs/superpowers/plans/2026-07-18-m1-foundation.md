# Travelers Inn — M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next 16 + Supabase (`booking` schema) project with Google auth, the shared-project invite gate, role guards, and an authenticated staff app shell.

**Architecture:** Mirror the prime-hrm-2 stack exactly. Custom Postgres schema `booking` holds all objects; Supabase clients are pre-bound to it. Auth is Google OAuth against the SHARED Supabase project — no triggers on `auth.users`; access is gated by a `booking.profiles` row provisioned by `booking.fn_claim_invitation()` on the auth callback/proxy. Mutations flow through server actions; reads through repositories.

**Tech Stack:** Next 16.2.x, React 19.2.x, TypeScript 5, Supabase (`@supabase/ssr` + `supabase-js`), Base UI + shadcn `base-nova`, Tailwind 4, Zod 4, react-hook-form 7, Supabase CLI (Colima local stack), Playwright.

## Global Constraints

- Node ≥ 22 (Next 16 requirement). Use `nvm use 22` before any `npm`/`next` command.
- Every DB object lives in schema `booking`, never `public`.
- Supabase project is SHARED: NO triggers on `auth.users`, NO project-wide auth hooks, always `signOut({ scope: "local" })`.
- Objects on shared surfaces are conceptually prefixed; functions live in `booking.*`.
- Next 16: `src/proxy.ts` (not middleware.ts); `cookies()`, `params`, `searchParams` are async.
- Mutations only via server actions: `"use server"` → `requireRole()` → Zod parse → repository → `logAudit()` → `revalidatePath()` → `ActionResult<T>`.
- Roles enum: `admin`, `front_desk`.
- Migrations idempotent-friendly; user applies to hosted DB manually; log each in this plan / PROJECT.md.

---

### Task 1: Scaffold project + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.nvmrc`, `.env.example`, `components.json`
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Create dirs: `src/{app,features,components/ui,components/layout,components/shared,hooks,lib,types}`

**Interfaces:**
- Produces: a running `next dev`; `@/*` path alias → `src/*`; Tailwind 4 pipeline; `npm run lint`/`build` scripts.

- [ ] **Step 1:** `nvm use 22 || nvm install 22`. Create `.nvmrc` with `22`.
- [ ] **Step 2:** Write `package.json` copying prime-hrm-2's dependency versions (next 16.2.10, react 19.2.4, @supabase/ssr, @supabase/supabase-js, @base-ui/react, shadcn, tailwindcss v4, zod, react-hook-form, @hookform/resolvers, @tanstack/react-query, @tanstack/react-table, lucide-react, sonner, next-themes, class-variance-authority, clsx, tailwind-merge, tw-animate-css; devDeps: typescript, eslint, eslint-config-next, prettier, prettier-plugin-tailwindcss, supabase, playwright-core, @types/*). Scripts: `dev/build/start/lint/format`, `db:start/db:stop/db:new/db:reset`, `db:types` (`supabase gen types typescript --local --schema booking > src/types/database.types.ts`), `test:db`. Set `"name": "travelers-inn"`, `engines.node >= 22`.
- [ ] **Step 3:** Copy `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `components.json` from prime-hrm-2 (components.json style stays `base-nova`). Write `.gitignore` (node_modules, .next, .env*.local, supabase/.temp, supabase/.branches, tsconfig.tsbuildinfo).
- [ ] **Step 4:** Write `.env.example` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`.
- [ ] **Step 5:** `npm install`. Write minimal `src/app/layout.tsx` (html/body + `globals.css` import + `next-themes` provider + sonner `<Toaster/>`), `src/app/globals.css` (Tailwind v4 `@import "tailwindcss"` + base-nova tokens copied from prime-hrm-2), and a temporary `src/app/page.tsx` redirecting to `/login`.
- [ ] **Step 6:** Run `npm run build`. Expected: PASS (compiles).
- [ ] **Step 7:** Commit.
```bash
git add -A && git commit -m "chore: scaffold Next 16 + Tailwind 4 project"
```

---

### Task 2: Local Supabase config + migration 1 (schema, grants, enums)

**Files:**
- Create: `supabase/config.toml`, `supabase/migrations/20260718000100_init_booking_schema.sql`, `supabase/seed.sql`
- Create: `.env.local` (from `supabase start` output)

**Interfaces:**
- Produces: schema `booking`; enums `booking.user_role`, `booking.invitation_status`; `booking.set_updated_at()` trigger fn.

- [ ] **Step 1:** `supabase init` (creates `supabase/config.toml`). Edit `config.toml`: `[api] schemas = ["booking", "public", "graphql_public"]` and `extra_search_path = ["booking", "public", "extensions"]`. Set `project_id = "travelers-inn"`.
- [ ] **Step 2:** Write migration 1:
```sql
create schema if not exists booking;
grant usage on schema booking to anon, authenticated, service_role;
alter default privileges in schema booking grant all on tables to anon, authenticated, service_role;
alter default privileges in schema booking grant all on routines to anon, authenticated, service_role;
alter default privileges in schema booking grant all on sequences to anon, authenticated, service_role;

create type booking.user_role as enum ('admin', 'front_desk');
create type booking.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

create or replace function booking.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
```
- [ ] **Step 3:** `colima start && npm run db:start`. Copy the printed API URL / anon key / service_role key into `.env.local`.
- [ ] **Step 4:** `npm run db:reset`. Expected: migration applies cleanly.
- [ ] **Step 5:** Commit.
```bash
git add -A && git commit -m "feat(db): booking schema, enums, local supabase config"
```

---

### Task 3: Migration 2 — identity (profiles, user_roles, invitations, audit_logs)

**Files:**
- Create: `supabase/migrations/20260718000200_identity_access.sql`

**Interfaces:**
- Produces tables: `booking.profiles(id,email,full_name,avatar_url,is_active,…)`, `booking.user_roles(user_id,role)`, `booking.invitations(email,role,status,expires_at,…)`, `booking.audit_logs(actor_id,action,entity,entity_id,diff,…)`.

- [ ] **Step 1:** Write migration 2 (adapted from prime-hrm identity_access, dropping `division_id` — this app is single-tenant):
```sql
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
create unique index invitations_pending_email_key on booking.invitations (lower(email)) where status = 'pending';

create table booking.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role booking.user_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
create index user_roles_user_id_idx on booking.user_roles (user_id);

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

create trigger set_updated_at before update on booking.profiles
  for each row execute function booking.set_updated_at();
create trigger set_updated_at before update on booking.invitations
  for each row execute function booking.set_updated_at();
```
- [ ] **Step 2:** `npm run db:reset`. Expected: PASS.
- [ ] **Step 3:** Commit.

---

### Task 4: Migration 3 — auth functions (RLS helpers + invite claim)

**Files:**
- Create: `supabase/migrations/20260718000300_auth_functions.sql`

**Interfaces:**
- Produces fns: `booking.fn_is_admin()`, `booking.fn_has_role(p_role)`, `booking.fn_is_active_user()`, `booking.fn_claim_invitation() returns boolean`.

- [ ] **Step 1:** Write helpers (SECURITY DEFINER, `set search_path = ''`):
```sql
create or replace function booking.fn_has_role(p_role booking.user_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from booking.user_roles
    where user_id = (select auth.uid()) and role = p_role);
$$;

create or replace function booking.fn_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from booking.user_roles
    where user_id = (select auth.uid()) and role = 'admin');
$$;

create or replace function booking.fn_is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from booking.profiles
    where id = (select auth.uid()) and is_active);
$$;
```
- [ ] **Step 2:** Write `fn_claim_invitation()` (adapted from prime-hrm; no division; **first-ever claim with no invitation but empty profiles table becomes the admin owner** — see body). It reads email/name/avatar from `auth.users`, upserts a `profiles` row and `user_roles` when a live invitation matches, marks the invitation accepted, and returns true iff the user ends with a profile. Bootstrap rule: if `booking.profiles` is empty AND no invitation exists, provision the caller as `admin` (owner bootstrap).
```sql
create or replace function booking.fn_claim_invitation()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text; v_name text; v_avatar text;
  v_inv record; v_bootstrap boolean := false;
begin
  if v_uid is null then return false; end if;
  select lower(u.email),
         coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email),
         coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
    into v_email, v_name, v_avatar from auth.users u where u.id = v_uid;

  if exists (select 1 from booking.profiles where id = v_uid) then return true; end if;

  select * into v_inv from booking.invitations
    where lower(email) = v_email and status = 'pending' and expires_at > now() limit 1;

  if v_inv.id is null then
    -- Owner bootstrap: the very first user with no invitations becomes admin.
    if not exists (select 1 from booking.profiles) then v_bootstrap := true;
    else return false; end if;
  end if;

  insert into booking.profiles (id, email, full_name, avatar_url)
    values (v_uid, v_email, v_name, v_avatar)
    on conflict (id) do nothing;

  insert into booking.user_roles (user_id, role)
    values (v_uid, coalesce(v_inv.role, 'admin'::booking.user_role))
    on conflict do nothing;

  if v_inv.id is not null then
    update booking.invitations set status = 'accepted', accepted_at = now() where id = v_inv.id;
  end if;
  return true;
end; $$;
```
- [ ] **Step 3:** `npm run db:reset`. Expected: PASS.
- [ ] **Step 4:** Commit.

---

### Task 5: Migration 4 — RLS policies

**Files:**
- Create: `supabase/migrations/20260718000400_rls_policies.sql`

**Interfaces:**
- Produces: RLS enabled on all identity tables; self-read on profiles; admin-manage on invitations/user_roles; audit_logs insert by authenticated, no update/delete.

- [ ] **Step 1:** Enable RLS + policies:
```sql
alter table booking.profiles enable row level security;
alter table booking.user_roles enable row level security;
alter table booking.invitations enable row level security;
alter table booking.audit_logs enable row level security;

create policy profiles_self_read on booking.profiles for select
  using (id = (select auth.uid()) or booking.fn_is_admin());
create policy profiles_admin_write on booking.profiles for update
  using (booking.fn_is_admin()) with check (booking.fn_is_admin());

create policy roles_self_read on booking.user_roles for select
  using (user_id = (select auth.uid()) or booking.fn_is_admin());
create policy roles_admin_all on booking.user_roles for all
  using (booking.fn_is_admin()) with check (booking.fn_is_admin());

create policy invites_admin_all on booking.invitations for all
  using (booking.fn_is_admin()) with check (booking.fn_is_admin());

create policy audit_insert on booking.audit_logs for insert to authenticated with check (true);
create policy audit_read on booking.audit_logs for select using (booking.fn_is_admin());
```
- [ ] **Step 2:** `npm run db:reset`. Expected: PASS.
- [ ] **Step 3:** Commit.

---

### Task 6: Supabase clients + proxy

**Files:**
- Create: `src/lib/supabase/{client,server,admin,middleware}.ts`, `src/proxy.ts`
- Create: `src/types/database.types.ts` (generated)

**Interfaces:**
- Produces: `createClient()` (browser), `createClient()` (server, async), `createAdminClient()`, `updateSession(req)`; `proxy` export.

- [ ] **Step 1:** Copy the four supabase client files from prime-hrm-2, replacing `"prime"` → `"booking"` in generics and `db.schema`. In `middleware.ts`, simplify the no-profile branch: call `supabase.rpc("fn_claim_invitation")`; if false → `signOut({scope:"local"})` + redirect `/login?error=uninvited` (remove the applicant provisioning branch). Set `PUBLIC_PATHS = ["/login", "/auth", "/", "/book", "/search"]` (portal is public).
- [ ] **Step 2:** Copy `src/proxy.ts` verbatim from prime-hrm-2.
- [ ] **Step 3:** Generate types: `npm run db:types`. Expected: `src/types/database.types.ts` written with `booking` schema.
- [ ] **Step 4:** `npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 7: Auth primitives (guards, action-result, audit)

**Files:**
- Create: `src/lib/action-result.ts`, `src/lib/audit.ts`, `src/lib/auth/guards.ts`

**Interfaces:**
- Produces: `ActionResult<T>`, `ok`, `fail`, `toActionError`; `logAudit({action,entity,entityId,diff})`; `getCurrentUser`, `requireUser`, `requireRole`, `hasRole`, type `UserRole`, `CurrentUser`.

- [ ] **Step 1:** Copy `action-result.ts` verbatim from prime-hrm-2.
- [ ] **Step 2:** Write `src/lib/audit.ts`: `logAudit` uses the admin client to insert into `booking.audit_logs`, never throws (wrap in try/catch + console.error).
- [ ] **Step 3:** Write `guards.ts` adapted from prime-hrm (drop division scoping): `getCurrentUser` (cache) reads `profiles` + `user_roles`; `requireUser` redirects `/login` if none/inactive; `hasRole(user, role)` (admin passes all); `requireRole(roles[])` throws `ForbiddenError`.
- [ ] **Step 4:** `npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 8: Login page + Google sign-in + callback

**Files:**
- Create: `src/app/(auth)/layout.tsx`, `src/app/(auth)/login/page.tsx`, `src/features/auth/components/google-sign-in-button.tsx`, `src/features/auth/actions.ts`, `src/app/auth/callback/route.ts`
- Create: shadcn `card`, `button` in `src/components/ui/`

**Interfaces:**
- Consumes: `createClient` (browser), server client.
- Produces: `/login` route rendering Google button; `/auth/callback` exchanging code + claiming invite.

- [ ] **Step 1:** `npx shadcn@latest add card button` (style base-nova). Verify files land in `src/components/ui/`.
- [ ] **Step 2:** Write `GoogleSignInButton` ("use client"): calls `supabase.auth.signInWithOAuth({ provider:"google", options:{ redirectTo: \`${location.origin}/auth/callback\` }})`.
- [ ] **Step 3:** Write `(auth)/layout.tsx` (centered card container) and `(auth)/login/page.tsx` adapted from prime-hrm (title "Travelers Inn", error messages map, `searchParams` async).
- [ ] **Step 4:** Write `auth/callback/route.ts` adapted from prime-hrm: exchange code → check profile → if none, `rpc("fn_claim_invitation")` → false ⇒ `signOut({scope:"local"})` + `/login?error=uninvited`; else redirect `next ?? /dashboard`.
- [ ] **Step 5:** `npm run build`. Expected: PASS.
- [ ] **Step 6:** Commit.

---

### Task 9: Authenticated app shell + dashboard placeholder

**Files:**
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/components/layout/{app-sidebar,app-header,sign-out-button}.tsx`
- Create: shadcn `avatar`, `dropdown-menu`, `sidebar` (or equivalent nav)

**Interfaces:**
- Consumes: `requireUser`, `getCurrentUser`.
- Produces: protected `/dashboard` showing signed-in user; nav links to future routes; sign-out (`scope:"local"`).

- [ ] **Step 1:** `(app)/layout.tsx`: `const user = await requireUser();` render sidebar (nav: Dashboard, Calendar, Bookings, Rooms, Room Types [admin], Users [admin]) + header with user menu.
- [ ] **Step 2:** `SignOutButton` ("use client"): `supabase.auth.signOut({ scope:"local" })` then `router.push("/login")`.
- [ ] **Step 3:** `(app)/dashboard/page.tsx`: greet user, placeholder stat cards (Arrivals today / Occupancy / Revenue — static zeros for now).
- [ ] **Step 4:** `npm run build && npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 10: Invite-claim DB test + auth smoke

**Files:**
- Create: `supabase/tests/invite-claim.test.mjs`
- Create: `supabase/tests/_helpers.mjs` (service-role client, test user seeding)

**Interfaces:**
- Consumes: local stack env; `fn_claim_invitation`.
- Produces: passing `node supabase/tests/invite-claim.test.mjs`.

- [ ] **Step 1:** Write `_helpers.mjs`: builds a service-role supabase client bound to `booking`, plus helpers to create an `auth.users` row (via admin `auth.admin.createUser`) and set the JWT sub for RPC calls.
- [ ] **Step 2:** Write failing test `invite-claim.test.mjs`: (a) first user with empty profiles + no invite → claim returns true, gets `admin` role (bootstrap); (b) second uninvited user → claim returns false, no profile; (c) invited `front_desk` email → claim returns true, gets `front_desk` role, invitation marked accepted.
- [ ] **Step 3:** `npm run db:reset` then `node supabase/tests/invite-claim.test.mjs`. Expected: FAIL first (assert wiring), then iterate to PASS.
- [ ] **Step 4:** Add the test to `test:db` script in package.json.
- [ ] **Step 5:** Manual auth smoke: `npm run dev`, visit `/login`, confirm Google button renders and `/dashboard` redirects to `/login` when signed out. (Full Google flow needs real creds + Supabase Google provider configured with the callback URL.)
- [ ] **Step 6:** Commit.

---

## Self-Review

- **Spec coverage (§2 constraints, §3 identity tables, invite gate, roles, testing):** Tasks 2–5 cover schema + identity + auth fns + RLS; Task 6–8 cover clients/proxy/auth gate; Task 9 the shell; Task 10 tests. Room/booking/portal tables are intentionally deferred to M2–M5 plans.
- **Placeholders:** none — all SQL and file responsibilities are concrete. Client TS is "copy from prime-hrm-2 with `prime`→`booking`" which is a precise, verifiable transform.
- **Type consistency:** role enum `('admin','front_desk')` used identically across migrations 2–5, guards, and tests. `fn_claim_invitation()` referenced by name in middleware.ts (Task 6) and callback (Task 8) — matches migration 4.
- **Note:** Google OAuth end-to-end requires the user to configure the Google provider + callback URL in the Supabase dashboard; local DB tests use password/service-role auth instead (Task 10).
