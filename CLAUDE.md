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
  the admin client with future-date/max-stay guards; `listPortalAvailability`
  computes per-type availability + price. 2 portal DB tests (27 total). Portal
  booking appears in staff `/bookings` unpaid. **Correction (see the deposits
  milestone below): "fn stays off the anon grant" was never actually true at
  this point** — `fn_create_booking` carried a live `anon` EXECUTE grant via
  migration 1's `alter default privileges` until migration
  `20260726000600` explicitly revoked it. Auto-confirm is also since GONE —
  portal bookings now require a verified deposit; see below.
- **M6 Reports & Dashboard — DONE**: the placeholder dashboard now shows real
  figures — arrivals/departures today, in-house, tonight's occupancy %, revenue
  today, outstanding balance, and 7-day revenue & occupancy trend bars. Metrics
  are pure functions in `features/reports/reports.ts` (`computeDashboard`),
  fetched by `features/reports/repository.ts`; arrivals/departures lists reuse
  the booking manage dialog. 7 pure-function unit tests via
  `node --experimental-strip-types` (34 total).
- **ALL SIX MILESTONES COMPLETE.** Whole product live: staff auth, rooms/rates,
  booking engine + walk-ins, front-desk ops, public portal, dashboard.
- **Tiered pricing + occupancy — DONE** (migration `20260719000100`): the old
  linear `nightly_rate`/`hourly_rate` + `stay_type` model is GONE. Pricing now
  lives in **`booking.rate_tiers`** (admin-configurable per room type): each tier
  is `kind='block'` (fixed `duration_hours`, flat price — check-out derived) or
  `kind='overnight'` (price × nights). Occupancy is on `room_types`
  (`base_occupancy`, `max_occupancy`, `excess_person_rate`); excess heads over
  base are charged **per night** for overnight, once for blocks. Bookings carry
  `rate_tier_id` + `guest_count`. `fn_create_booking` signature is now
  `(name, phone, email, room_type_id, rate_tier_id, guest_count, check_in,
  check_out, source, notes)` and stays authoritative on price. TS mirror is
  `features/bookings/pricing.ts` `quote(tier, occ, guestCount, checkIn, checkOut?)`.
  Room-type form has a nested tier editor (soft-deactivates removed tiers, never
  hard-deletes — bookings FK-reference tiers). Portal & walk-in both pick
  tier + guests with live pricing. Tests: engine (10), rooms (9), front-desk (7),
  portal (2), reports (7), pricing unit (5) = 40 total.
- **Deposits, staff verification, feedback QR codes, multi-photo rooms — DONE**
  (migrations `20260726000100`–`20260726000600`): a public no-login portal
  booking is no longer auto-confirmed. It now costs a deposit
  (`booking.settings`, admin-editable — GCash/bank details, `deposit_percent`,
  inn address/coordinates for the map; `is_public` rows are anon-readable, the
  rest staff-only) that the guest pays off-platform and uploads proof for
  (`booking.booking_proofs`, private, staff-read only). The booking is created
  as `pending_verification` — a new `booking_status` value that **holds the
  room**: it's in the `no_overlap` GiST exclusion constraint alongside
  `confirmed`/`checked_in` (a paid guest can never lose the room to a later
  booker), and every availability function (`fn_count_available`,
  `fn_available_rooms`) was widened to match. `fn_create_booking` gained a
  trailing `p_status` parameter (default `confirmed`, portal passes
  `pending_verification`) — signature is now `(name, phone, email,
  room_type_id, rate_tier_id, guest_count, check_in, check_out, source, notes,
  status)`. Proof files land in the **private** `travelers-inn-payment-proofs`
  bucket (staff read via signed URL; the room-photo bucket stays public — two
  different trust levels, two different buckets). Staff verify/reject via a
  panel in the booking manage dialog (`features/bookings/verification-actions.ts`,
  `components/verification-panel.tsx`). Guest feedback: `booking.feedback` has
  **no anon policy at all** — every insert goes through
  `fn_submit_feedback` (`SECURITY DEFINER`, service_role only), reached by a
  printed per-room QR code (`/rooms/qr` renders one card per room; guests land
  on public `/feedback/[roomId]`). Room types can now carry multiple photos
  (`booking.room_type_photos`, public-read, admin-write); `room_types.image_url`
  is kept as the cover and stays synced to the lowest-`sort_order` photo, so
  everything that already read `image_url` (portal cards, OG metadata, the
  admin thumbnail) needed no changes. Security hardening: migration
  `20260726000600` explicitly revokes `anon`/`public` EXECUTE on the five
  SECURITY DEFINER functions that don't belong to anon (`fn_create_booking`,
  `fn_count_available`, `fn_available_rooms`, `fn_claim_invitation`,
  `fn_submit_feedback`) — migration 1's `alter default privileges ... grant
  all on routines to anon` had been silently handing every new/changed
  function a live anon EXECUTE grant, which is how `fn_create_booking`
  reacquired it when this branch added `p_status`. **Read that migration's
  comments before adding any new `booking.*` function**: a schema-scoped
  `alter default privileges ... revoke` does NOT reliably stop this — Postgres
  grants EXECUTE to `PUBLIC` (which `anon` inherits) unconditionally at
  `CREATE FUNCTION` time, and a schema-scoped revoke cannot override that
  built-in default (confirmed by testing on this stack; a database-wide revoke
  would work but reaches every schema the migrating role touches on this
  SHARED project, so it isn't used). The only thing that actually works: every
  new SECURITY DEFINER function needs its own explicit `revoke execute ... from
  public, anon;` right after `create function`, same as the five here. New
  test files: `verification.test.mjs` (9), `feedback.test.mjs` (8),
  `deposit.test.ts` (7 unit tests for `depositFor()`); `rooms.test.mjs` grew
  for the multi-photo gallery. **69 total** (`npm run test:db`).
- **Staff management page — DONE** (no migration; the tables have been there
  since M1): the sidebar's admin-only "Staff" item pointed at `/users`, which
  had never been built — the link 404'd. `features/users/*` +
  `app/(app)/users/page.tsx` now render the roster (`profiles` joined to
  `user_roles` in JS — the two tables hang off `auth.users` with no FK between
  them, so PostgREST can't embed either in the other) and the invitation list.
  Admin can invite (whitelists an email in `booking.invitations`; **nothing is
  emailed** — the invitee signs in with Google and `fn_claim_invitation()` does
  the rest), revoke, change a member's role, and deactivate/reactivate.
  Inviting an email that already has a live invitation **renews** that row
  rather than inserting — the partial unique index allows one pending invite
  per email. Role change replaces the whole role set (insert first, then drop
  the others, so a member is never momentarily role-less). Every mutation
  refuses to act on the caller's own row, which is also the lockout guard:
  only an admin gets this far, so an active admin always survives. Deactivation
  never deletes (audit logs reference the actor) — `proxy.ts` bounces a
  deactivated profile to `/login?error=deactivated`. New `staff.test.mjs` (9)
  covers the RLS boundaries and those write shapes. **78 total**.
- **Booking attribution + admin reports — DONE** (migration `20260806000100`).
  *Attribution*: `bookings.created_by` (already set by `fn_create_booking` from
  `auth.uid()` — null for portal bookings, which run through the service-role
  client) and `payments.recorded_by` were recorded but never shown; the
  verifier lived only in `audit_logs`. New `bookings.verified_by` /
  `verified_at` are written **inside the same conditional UPDATE** that
  confirms a deposit (`verification-actions.ts`), so attribution is as
  race-safe as the status flip — the loser of a two-staff race re-stamps
  nothing. `audit_logs` is best-effort by design (`logAudit` swallows its own
  errors), which is why reported-on attribution gets real columns instead.
  The manage dialog now shows booked-by/channel/taken-on, deposit
  verified-by/on, each payment's mode + amount + **who received it**, and a
  chronological **activity trail**; the bookings list gained a searchable
  "Handled by" column (`listBookingsWithStaff`).
  *Two new SECURITY DEFINER readers* exist because front desk may read neither
  `audit_logs` (admin-only; also holds settings/role changes) nor other
  people's `profiles` (self-only; holds emails): `fn_booking_trail(booking)`
  returns ONE booking's audit rows with actor names joined, and
  `fn_staff_names(uuid[])` returns ids → names and nothing else. Both are
  gated on `fn_is_active_user()` and both carry the mandatory
  `revoke execute ... from public, anon` (see migration `20260726000600`).
  Neither policy was widened.
  *Reports* (`/reports`, admin-only, sidebar "Reports"): date range in the URL
  (`?from=&to=`, defaults to month-to-date) + presets, print, and client-side
  CSV export of the payments and bookings ledgers. Two clocks, deliberately:
  **financial** figures follow the cash (a payment counts in the range it was
  RECEIVED), **occupancy/ADR** follow the stay, and "bookings taken" follows
  the booking date. Breakdowns by payment mode, by staff who collected, by
  status, channel, room type, staff who took the booking, and staff who
  verified deposits. Pure maths in `features/reports/analytics.ts` (no imports,
  so it unit-tests under `--experimental-strip-types`); `csv.ts` escapes and
  neutralises leading `=`/`+`/`-`/`@` against spreadsheet formula injection.
  Room-nights reuse the dashboard's night window (14:00 → next 12:00), so an
  ordinary overnight stay is ONE night rather than the two dates it touches —
  counting dates would inflate occupancy and halve ADR. New tests:
  `attribution.test.mjs` (10 DB) + `analytics.test.ts` (25 unit).
  **113 total** (`npm run test:db`).
- **Walk-in pays in full at booking — DONE** (no migration): a walk-in settles
  the whole price at the counter, so the payment is part of the walk-in form
  instead of a second trip through the manage dialog. **There is no amount
  field** — `bookingSchema` carries only `payment_method` and
  `payment_reference`, and `createBooking` inserts a payment for the row's own
  `quoted_total` (the price `fn_create_booking` just computed) with
  `recorded_by = auth.uid()` plus a `payment.record` audit entry. Recording the
  server's own figure rather than a client-supplied one is what makes a part
  payment or an overpayment *impossible* here instead of merely discouraged,
  and it keeps the ledger, the trigger-derived `payment_status` and the
  activity trail identical to what the manage dialog would have produced. The
  two writes can't share a transaction (the booking comes back from an RPC), so
  a failed payment insert is **reported, not swallowed** — the action returns
  `paymentError` and the toast says the booking exists but the money isn't on
  the ledger. `recordPayment` (manage dialog) now also refuses to exceed the
  outstanding balance — it was the only remaining way to overpay a booking, and
  an overpayment has no expressible meaning in reports. Deposit-then-balance on
  *portal* bookings is untouched: those are still two payments by design.
- **Staff-app UI aligned with bayugan-tracks — DONE** (no migration, no server
  logic): the `(app)` surfaces now share that project's visual system so the two
  internal tools read as one. `globals.css` swapped the warm teal/parchment
  tokens for its palette (page `#F0F2F5`, white cards, `#1877F2` primary, a dark
  sidebar in BOTH themes) and gained `--sidebar-muted-foreground` /
  `--sidebar-hover`; `--font-sans` is now Plus Jakarta Sans. **The public portal
  and the login page are deliberately untouched** — both already sit inside
  `.force-light`, which pins every colour token they use and now also aliases
  `--font-sans` back to `--font-dm-sans`, so the guest-facing editorial identity
  (Fraunces + DM Sans + teal/amber) survives a palette change made for staff.
  `ui/sidebar.tsx` was replaced with that project's leaner implementation
  (sticky full-height, width-animated, Sheet on mobile, no icon-collapse) —
  **its slots are `data-sidebar="…"`, not `data-slot=`, which is why the print
  rules in `globals.css` had to change with it**. The nav is a plain `Link` with
  an active blue rail, split into front-desk and admin groups. `AppHeader` grew
  breadcrumbs (`components/layout/breadcrumbs.tsx`, a client component because
  it reads `usePathname`).
  The shared `DataTable` was rebuilt around the same table kit — a toolbar
  (global search + multi-select **faceted filter** chips with live facet counts
  + Reset), a card-wrapped table with a muted uppercase header row, and a
  footer with rows-per-page. Faceted filters are multi-select, so every
  filterable column needs `filterFn: includesValue` (exported from
  `shared/data-table.tsx`) — TanStack's default is single-value equality and
  silently matches nothing once a second option is ticked. Wired up on
  bookings (status / payment / channel — `source` is a **hidden** filter-only
  column), rooms (type / status) and staff (role / status); feedback's existing
  rating select moved into the toolbar. The old `serverPagination` prop is
  gone — nothing used it. New `shared/section-card.tsx` is the ruled panel the
  dashboard, reports and the settings form now share.
- **User menu + self-service profile — DONE** (migration `20260807000100`).
  *The bug*: the header's account menu threw on open and drew nothing. Base
  UI's `Menu.GroupLabel` reads `MenuGroupContext` and **raises** without a
  `Menu.Group` around it, so `DropdownMenuLabel` outside a `DropdownMenuGroup`
  takes the whole popup down rather than degrading. Wrap every
  `DropdownMenuLabel` in a `DropdownMenuGroup`.
  *The menu* now holds the identity block, **Edit profile** → `/profile`, and
  Sign out (still `signOut({ scope: "local" })` — this is a SHARED Supabase
  project).
  *Editing*: `booking.profiles` still has **no self-update policy**, and that is
  deliberate — a row-level policy grants the whole ROW, and this row carries
  `is_active` (the deactivation flag `proxy.ts` enforces; a self-update would
  let a deactivated user reactivate themselves and undo the staff-management
  milestone) and `email` (what `fn_claim_invitation` matches an invitation on).
  Postgres RLS has no column-level `WITH CHECK`, so the write is
  `booking.fn_update_my_profile(text)` instead: SECURITY DEFINER, gated on
  `fn_is_active_user()`, writing one column on the row `auth.uid()` names —
  **there is no id parameter to forge**. It carries the mandatory
  `revoke execute … from public, anon` (see `20260726000600`). Guard is
  `requireUser`, not `requireRole`: everyone owns their own name.
  `revalidatePath("/", "layout")` because the name is drawn in the header on
  every staff page. Email, photo and role are shown read-only with a line
  saying where they come from, rather than as three disabled inputs.
  New `profile.test.mjs` (7) — mostly negative: blank/oversized names refused,
  `is_active`/`email` unmoved, a direct UPDATE on `profiles` still refused for
  front desk, and a deactivated user refused. **128 total** (`npm run test:db`).
