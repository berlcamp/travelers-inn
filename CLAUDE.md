# Travelers Inn — Project Rules for Claude

Booking & Reservation Management System for a Travelers Inn. Two surfaces:
internal staff tools (`(app)`, Google login) and a public booking portal
(`(portal)`, no login — added in M5). Built on the prime-hrm-2 stack.

Design spec: `docs/superpowers/specs/2026-07-18-travelers-inn-booking-design.md`
Plans: `docs/superpowers/plans/`

## Hard constraints

- **Custom schema `booking`** — every DB object lives there, never `public`.
  Supabase clients are pre-bound via `{ db: { schema: "booking" } }`
  (`src/lib/supabase/*`). Types: `npm run db:types`.
- **SHARED Supabase project** (same `auth.users` as prime-hrm and others):
  NEVER create triggers on `auth.users`, NEVER register project-wide auth
  hooks, always `signOut({ scope: "local" })`. Access gate is profile-based via
  `booking.fn_claim_invitation()` (auth callback + proxy). The first-ever user
  (empty `profiles`) is bootstrapped as `admin`; everyone else needs a live
  `booking.invitations` row.
- **Migrations** (`supabase/migrations/NNN_*.sql`): applied to the hosted DB
  manually by the user — keep them idempotent-friendly. Functions live in
  `booking.*`.
- **shadcn style is `base-nova` (Base UI, not Radix)**: composition uses the
  `render` prop — there is **no `asChild`**.
- **Next 16**: `src/proxy.ts` (not middleware.ts); `cookies()`, `params`,
  `searchParams` are async.
- **Roles**: `admin`, `front_desk` (`booking.user_role`). Admin passes every
  `hasRole` check.

## Conventions

- Mutations only via server actions: `"use server"` in
  `features/<module>/actions.ts` → `requireRole()` guard → Zod parse (schema
  shared with the form) → repository/supabase → `logAudit()` →
  `revalidatePath()` → return `ActionResult<T>` (`lib/action-result.ts`).
- Reads via `features/<module>/repository.ts` using the RLS-scoped server
  client; admin client (`lib/supabase/admin.ts`) only where RLS can't express
  the rule (portal availability + booking insert, audit writes).
- Guards: `getCurrentUser`/`requireUser`/`requireRole`/`hasRole` from
  `lib/auth/guards.ts`.

## Local environment

- **Node ≥ 22** (Next 16). `nvm use 22` (or prepend
  `$HOME/.nvm/versions/node/v22.23.1/bin` to PATH — nvm is a shell function).
- **Local Supabase via Colima** (`colima start`) + Supabase CLI as a
  devDependency (`npm run db:*` resolves it from `node_modules/.bin`).
- **This project uses the `546xx` port range** in `supabase/config.toml`
  (API 54621, DB 54622, Studio 54623) so it can run alongside other local
  Supabase stacks (prime-hrm 543xx, hris 544xx, point-of-sale 555xx).
- `npm run db:start` then `npm run db:reset` applies migrations + seed.
- `.env.local` holds the local anon/service keys. Google sign-in needs real
  credentials in the Supabase Dashboard (hosted) or `.env.local` (local);
  DB/RLS tests use password auth against local GoTrue instead.

## Verification

1. Real stack: `npm run db:reset`, then exercise code paths (see
   `supabase/tests/*.mjs`, run `npm run test:db`).
2. `npm run db:types` after every migration; re-run `npm run build`.
3. `npm run lint && npm run build` + a route smoke test before closing a milestone.

## Milestone status

- **M1 Foundation — DONE**: schema, invite gate, Google auth, app shell,
  dashboard placeholder, invite-claim tests.
- **M2 Rooms & Rates — DONE**: room_types + rooms tables (public-read RLS),
  shared data-table/form-fields, admin CRUD for room types, rooms list with
  inline housekeeping status, demo seed, room DB/RLS tests.
- **M3 Bookings Core — DONE**: bookings table with `tstzrange` + GiST
  `no_overlap` exclusion constraint (the double-booking guarantee);
  `fn_create_booking` (auto-assign room, authoritative nightly/hourly pricing,
  race-safe) + `fn_count_available`; bookings list, walk-in quick-book dialog
  with live availability + price preview; cancel frees the room; 8 engine tests.
- **M4 Front Desk Ops — DONE**: payments table + trigger deriving
  `bookings.payment_status`; `fn_available_rooms`; check-in/out/no-show actions
  (sync room housekeeping status); record-payment + room reassignment; a booking
  **manage dialog** hosting all of it; a rooms × 14-days occupancy **calendar**;
  7 front-desk DB tests (25 total). Note: booking action helpers live in
  `features/bookings/front-desk-actions.ts` (loadBookingDetail, checkIn,
  checkOut, markNoShow, recordPayment, reassignRoom).
- **M5 Public Portal — DONE**: public no-login `(portal)` route group (root `/`
  is now the portal home; old redirect page removed) with a distinct editorial
  look (Fraunces display font, gradient room visuals). Search availability →
  room cards with prices → book with contact details → **auto-confirmed** with a
  reference code. `createPortalBooking` (source `portal`) runs server-side via
  the admin client (fn stays off the anon grant) with future-date/max-stay
  guards; `listPortalAvailability` computes per-type availability + price. 2
  portal DB tests (27 total). Portal booking appears in staff `/bookings` unpaid.
- Next: M6 Reports/dashboard.
