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
  _Attribution_: `bookings.created_by` (already set by `fn_create_booking` from
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
  _Two new SECURITY DEFINER readers_ exist because front desk may read neither
  `audit_logs` (admin-only; also holds settings/role changes) nor other
  people's `profiles` (self-only; holds emails): `fn_booking_trail(booking)`
  returns ONE booking's audit rows with actor names joined, and
  `fn_staff_names(uuid[])` returns ids → names and nothing else. Both are
  gated on `fn_is_active_user()` and both carry the mandatory
  `revoke execute ... from public, anon` (see migration `20260726000600`).
  Neither policy was widened.
  _Reports_ (`/reports`, admin-only, sidebar "Reports"): date range in the URL
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
  payment or an overpayment _impossible_ here instead of merely discouraged,
  and it keeps the ledger, the trigger-derived `payment_status` and the
  activity trail identical to what the manage dialog would have produced. The
  two writes can't share a transaction (the booking comes back from an RPC), so
  a failed payment insert is **reported, not swallowed** — the action returns
  `paymentError` and the toast says the booking exists but the money isn't on
  the ledger. `recordPayment` (manage dialog) now also refuses to exceed the
  outstanding balance — it was the only remaining way to overpay a booking, and
  an overpayment has no expressible meaning in reports. Deposit-then-balance on
  _portal_ bookings is untouched: those are still two payments by design.
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
  - Reset), a card-wrapped table with a muted uppercase header row, and a
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
  _The bug_: the header's account menu threw on open and drew nothing. Base
  UI's `Menu.GroupLabel` reads `MenuGroupContext` and **raises** without a
  `Menu.Group` around it, so `DropdownMenuLabel` outside a `DropdownMenuGroup`
  takes the whole popup down rather than degrading. Wrap every
  `DropdownMenuLabel` in a `DropdownMenuGroup`.
  _The menu_ now holds the identity block, **Edit profile** → `/profile`, and
  Sign out (still `signOut({ scope: "local" })` — this is a SHARED Supabase
  project).
  _Editing_: `booking.profiles` still has **no self-update policy**, and that is
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
- **Role-aware menu + access-denied pages — DONE** (no migration). A signed-in
  user whose roles didn't match a page got a **500**: `requireRole` throws
  `ForbiddenError`, and a throw in a Server Component renders the error
  boundary. The sidebar showed Availability/Calendar/Bookings to everyone, so a
  role-less account (invited, or mid role-change) saw menu items that answered
  with a crash — indistinguishable from the app being broken.
  _Two guards now, deliberately_: `requireRole` still throws and is for
  **server actions only** (their catch turns it into an `ActionResult`);
  **pages** use `pageRole(roles)`, which returns `CurrentUser | null` and
  renders `<AccessDenied requires={…} />` on null. Returning null rather than
  throwing is forced by Next: production **sanitises errors**, so the boundary
  sees a generic message plus a digest and cannot tell a permission refusal
  from a genuine crash. `forbidden()` was rejected — it needs
  `experimental.authInterrupts`.
  _One predicate for menu and guard_: `roleMatches(userRoles, allowed)` in
  **`lib/auth/roles.ts`**, NOT in `guards.ts` — guards imports the Supabase
  server client (`next/headers`), and the sidebar is a client component, so
  importing it from there pulls server-only code into the browser bundle and
  **fails the build**. `guards.ts` re-exports it so callers have one import
  site. Each `NavItem` carries the same `requires` array its page passes to
  `pageRole`; keep them in step. `ROLE_LABELS` also moved there — it had been
  duplicated in three files; `features/users/schemas.ts` re-exports it.
  Result by role — admin 10 menu items, front desk 6, no-role 3, and every
  route returns 200 for every role (restricted ones render the panel).
  New `roles.test.ts` (6 unit). **134 total** (`npm run test:db`).
- **Optional specific-room assignment — DONE** (migration `20260808000100`).
  `fn_create_booking` always chose the room (first free of the type in label
  order), so "the ground-floor one, please" meant book-then-reassign from the
  manage dialog: two writes, two audit entries, and a moment where the guest
  had been told a room number that was about to change. The function now takes
  a trailing **`p_room_id uuid default null`** — signature is
  `(name, phone, email, room_type_id, rate_tier_id, guest_count, check_in,
check_out, source, notes, status, room_id)`. Null keeps the old loop
  verbatim; supplied, the room is validated (exists, belongs to the type, not
  out of service) and inserted directly. Losing the exclusion-constraint race
  on a **named** room is an ERROR ("Room 103 is already booked for those
  dates"), never a silent fallback to a different room — honouring the type but
  not the room is the one outcome that would make the feature worse than
  useless. The auto-assign path still falls through to the next free room.
  _UI_: the walk-in dialog gained a **Room** select defaulting to "Any free
  room"; it and the live availability figure now come from ONE call
  (`listFreeRooms` → `fn_available_rooms`) rather than two, because the count
  is just the list's length and asking twice invited the answers to disagree.
  A named room that stops being free while the clerk types falls back to "any"
  with a note, rather than leaving a selection the server would only reject on
  submit. `bookingSchema` carries `room_id` (optional, `""` = any) and the
  action omits `p_room_id` entirely when empty — the parameter is `uuid`, so
  `""` is a cast error rather than "no preference". `audit_logs` records
  `room_chosen` so a human's choice is distinguishable from the auto-assign
  (every booking has a `room_id` either way).
  _The portal deliberately does NOT pass it_: a guest picking "205" builds an
  expectation housekeeping may have to break, and exposes the floor plan.
  **Trap**: adding the parameter minted a new function object, which Postgres
  grants to `PUBLIC` at `CREATE FUNCTION` time — the migration carries its own
  `revoke execute … from public, anon` and `bookings.test.mjs` now asserts anon
  is still refused. See `20260726000600`. `bookings.test.mjs` +7 (17).
  **149 total** (`npm run test:db`).
- **"Booking confirmed" room panel — DONE** (no migration, no server logic).
  Both confirmation paths ended in a **toast**, which is the wrong instrument:
  the clerk has to read a room number out loud to the guest, and a toast
  disappears on its own timer — possibly while they are still counting change.
  New `components/booking-confirmed-dialog.tsx` is a modal with the **room
  number as the headline** (4xl, with the room type under it) and reference,
  guest, stay window, rate, guest count and the money below. It is shared by
  both paths because both end the same way: a booking the guest can now walk
  into.
  _Walk-in_: `createBooking` returns only ids, and the room is only knowable
  after the server assigned it, so the dialog fetches `loadBookingDetail` after
  success. That fetch failing must NOT read as a failed booking — the booking
  exists and the toast already said so, so it just falls back to no panel.
  _Online_: the trigger is verifying the deposit, so `VerificationPanel` gained
  an **`onConfirmed`** callback separate from `onDone` (rejecting still uses
  `onDone`). `BookingManageDialog.onVerified()` re-reads the booking BEFORE
  showing the panel — otherwise it would render the `pending_verification` row
  the dialog was opened with rather than the confirmed one.
  _Balance_: shown only when > 0. A walk-in settles in full, so a ₱0.00 line
  would be noise there; a portal booking has a deposit paid and the rest due,
  which is the number the clerk actually has to say.
  Both panels render as **siblings** of their parent dialog, not nested: the
  parent closes as the panel opens, so two modals never stack and focus lands
  where the clerk is looking.
- **One hue per booking status — DONE** (no migration, no server logic). The
  status column was two colours for four meanings: `confirmed` and `checked_in`
  both drew the solid primary, and `pending_verification` shared grey with
  `checked_out` (only an amber className override told the first two apart).
  Scanning the column — which is how the list is actually read — could not
  distinguish "in the building" from "arriving later". Every status now gets
  its own tinted badge in one family (`border-<hue>/30 bg-<hue>/15
text-<hue>-700 dark:text-<hue>-300`, the pattern the old amber override
  already used) so they differ only by hue: amber = wants attention now, blue =
  settled/upcoming, emerald = in-house, slate = finished, rose = no-show.
  **`cancelled` is deliberately not a fill** — an outline reads as absence, and
  it separates the two "didn't happen" states by SHAPE rather than by two
  similar reds, which is what a colour-blind clerk has to go on.
  `PaymentStatusBadge` moved off blue in the same pass: a blue "Paid" sitting in
  the next column to a blue "Confirmed" is two different facts in one colour.
  Payment now reads red → amber → green (unpaid → partial → paid).
  Badges are used by the bookings table, the manage dialog and the reports
  ledger, so all three inherit this.
- **Collections Report (remittance / turn-over) — DONE** (no migration).
  `/reports` is admin-only and answers "how did the inn do"; a receptionist
  handing over a drawer needs a different document, so `/collections` is a new
  page open to **admin AND front_desk** (sidebar "Collections", in the
  front-desk group — it's shift work, not analysis).
  _Attribution is `payments.recorded_by`, NOT `bookings.created_by`._ Those are
  different people the moment one clerk books a guest and another collects the
  balance at check-out, and only the first answers "what is in this person's
  drawer". `/reports`' staff filter deliberately spans three columns
  (created_by / recorded_by / verified_by); this page uses exactly one.
  _Cash is separated from non-cash_ — GCash/card/bank money is already in an
  account and is reconciled, not counted out. "Cash to remit" is the headline
  tile and the figure restated beside the signatures. `isCashMethod()` in
  `analytics.ts` is the single definition.
  _Scope_: front desk is **pinned to their own id server-side** — `?staff=` is
  ignored for them rather than validated, and the picker isn't rendered — so a
  hand-typed id can't open a colleague's sheet. Admin may pick anyone or view
  everybody; the "Received by" column and the by-receptionist breakdown appear
  only in that all-staff view. Note this is a _product_ boundary, not a
  security one: `payments_staff_read` (migration 8) is gated on
  `fn_is_active_user()`, not on a role, which is precisely what lets this page
  exist for front desk without a new SECURITY DEFINER reader. Staff NAMES still
  come from `fn_staff_names` — `profiles` is self-only for front desk.
  _Range defaults to TODAY_ (not month-to-date like `/reports`): a remittance
  sheet is one shift. **Dates are the ONLY control** — `?from=&to=` in the URL,
  so a sheet stays reloadable and shareable. The receptionist picker, the
  payment-mode select and the range presets were all removed on request; the
  now-unreachable `method` plumbing went with them (`CollectionsFilters` is
  just `{ staffId }`, and `listCollectionStaff` is gone) rather than being left
  as a branch nothing can enter. **Consequence**: an admin now always sees the
  whole desk on one sheet — the by-receptionist breakdown and the "Received by"
  column still separate the drawers, but there is no longer a way to print ONE
  named clerk's sheet. Front desk is unaffected, and its scoping is _stronger_
  than before: whose sheet it is now follows purely from who is signed in, with
  nothing in the URL that could change it.
  _Print_ is the deliverable, and the printed sheet is a DIFFERENT document
  from the screen — it is three things only: `PrintHeader` (inn name, period,
  receptionist, timestamp), the **transactions table**, and `SignatureBlock`
  (restated total + cash, then **Turned over by / Received by** lines). Both
  live in `remittance-slip.tsx` as `hidden print:…`. The stat tiles, every
  breakdown card, the page header and the panel's own "TRANSACTIONS" title are
  all `print:hidden`: each is either derivable from the list below it or
  already restated beside the signatures, and the target is **one sheet of
  bond paper for an ordinary shift**.
  Density is where that is won: print-only cell padding (`print:py-[1px]`),
  9px type, the second line of the guest and mode cells folded **inline**
  instead of block, and room type dropped (the room label already identifies
  the room). Screen padding is untouched — a clerk tapping a row on a monitor
  needs the target. `<main>` loses its `p-4/p-6` on print (`print:p-0`); the
  `@page` margin is the real one, and doubling it cost rows. This also
  slightly widens the QR sheet, which is fine.
  Page geometry uses a **named page**: `.print-sheet { page: sheet }` +
  `@page sheet { size: 8.5in 11in; margin: 10mm }` in `globals.css`, so PH
  short bond applies here while the QR sheet keeps the A4 default. Named pages
  are a progressive enhancement — a browser that ignores `page:` falls back to
  A4 and still prints, just on more paper; long bond (8.5×13) fits anything
  sized for the shorter sheet. `SectionCard` gained a `headerClassName` prop
  for exactly this (dropping a ruled header the printed page already titles).
  CSV export reuses `reports/csv.ts` (formula-injection safe) and carries a
  Cash yes/no column.
- **Facebook share cards on room links — FIXED** (no migration). A shared
  `/book?type=…&checkIn=…&checkOut=…` link showed title and description but
  **no thumbnail**. The tags were all being served correctly and the image
  itself was a reachable 200 — the defect was what was MISSING:
  `og:image:width` / `og:image:height`. Facebook draws a card before it has
  downloaded the image, so with no declared dimensions the first scrape of a
  URL has no picture. Normally invisible (a handful of URLs, scraped once and
  cached) — but every shared room link carries the SHARER's own dates, so every
  share is a URL Facebook has never seen, and every share was a first scrape.
  Room covers are uploaded by staff, so their size isn't known ahead of time
  and can't be hardcoded. `lib/og-image.ts` `coverOgImage()` instead rewrites
  the Supabase public-object URL to the **image-transform endpoint**
  (`/storage/v1/object/public/` → `/storage/v1/render/image/public/` +
  `?width=1200&height=630&resize=cover`), which makes the dimensions true by
  construction and lands on the 1.91:1 ratio Facebook crops to anyway.
  Transformations are a paid Supabase feature — **verified live on this
  project** before relying on them. A URL that isn't a Supabase public object
  is returned untouched and WITHOUT dimensions: rewriting it blindly would turn
  a working image into a 404, and losing the dimensions is only back to where
  we started. Zero is never emitted (`og:image:width 0` is worse than silence).
  _Second bug found in the same pass_: `SITE_URL` was
  `https://bti.kerisoftware.com`, but the deployment also answers on
  `https://www.banarestravellersinn.com`, which is the domain actually shared.
  `og:url` is what Facebook treats as canonical, so every share of a branded
  link was re-attributed to the other host — engagement accumulating on a URL
  nobody advertises, and a click-through that walked the guest off the brand.
  `SITE_URL` is now the www domain (the apex 308-redirects to it). QR codes
  already printed still work: the old host serves the same app.
  New `og-image.test.ts` (8 unit). **185 total** (`npm run test:db`).
- **Reports unlisted from the sidebar** (no other change). `/reports` still
  exists and still guards itself with `pageRole(["admin"])`, so bookmarks keep
  working — only the menu item is gone. Re-add one line to `ADMIN` in
  `app-sidebar.tsx` to bring it back; the page needs nothing.
  _Where the code lives_: the maths is `computeCollectionsReport` in
  **`features/reports/analytics.ts`**, not in the new feature — that file is
  the one module pure enough to unit-test under `--experimental-strip-types`,
  and it already owns `rangeBounds`, so a collections sheet and a report can
  never disagree about what "1–7 August" contains. It's generic over the
  payment row (`<P extends ReportPayment>`) so `features/collections` can carry
  room label + channel through without widening `ReportPayment`.
  `CollectionsFilters.method` stays a plain `string` there (no imports allowed)
  and is re-narrowed against the enum in the repository — an unknown value
  would otherwise reach Postgres as a cast error, not as "no match".
  New tests: `collections.test.ts` (11 unit) + `remittance.test.mjs` (6 DB —
  front desk can read the ledger with its nested embeds, each clerk's sheet
  holds what they RECEIVED, the day window includes 23:50, anon is refused, a
  deactivated clerk loses both the ledger and `fn_staff_names`).
  **177 total** (`npm run test:db`).
- **Cancelled money leaves revenue + check-out stamps the real time — DONE**
  (no migration).
  _Revenue_: a payment against a **cancelled** booking is no longer counted
  anywhere — dashboard "Revenue today" and its 7-day bars, `/reports`
  Collected (and its by-mode / by-staff / by-day breakdowns and the payments
  ledger), and the `/collections` remittance sheet, cash included. Cancelling
  hands the money back, so counting it reports revenue the inn no longer has
  and a drawer that isn't there. **`no_show` deliberately still counts**: that
  guest forfeited what they paid. `analytics.ts` therefore carries TWO lists —
  `VOID` (`cancelled` + `no_show`, "was this booking worth anything?", which
  already gated booked revenue) and the new `REFUNDED` (`cancelled` only, "did
  the inn keep the cash?") behind `countsAsRevenue(bookingStatus)`;
  `reports.ts` repeats the predicate locally because that module stays
  import-free to run under `--experimental-strip-types`. `ReportPayment` /
  `RptPayment` gained `bookingStatus`, resolved in the repositories — the
  dashboard **embeds** `booking:bookings(status)` on the payments query
  because its bookings query fetches only OCCUPYING statuses, so a cancelled
  booking would never be there to match. An unresolvable status is `""` and
  **counts**: silently losing money is the worse failure. The excluded figure
  is reported, never merely subtracted — `cancelledExcluded {count, amount}`
  surfaces in the Collected hint, the Total-collected tile, and the printed
  signature block, so a short drawer has a stated reason. `cancelBooking` now
  revalidates `/calendar` and `/dashboard` too.
  _Actual check-out_: a booked check-out is a PLAN (block = check-in +
  `duration_hours`, which already crosses midnight correctly — 17:00 + 12h is
  05:00 the next day in both `pricing.ts` and `fn_create_booking`; overnight =
  standard noon). `checkOut` now replaces it with the moment staff pressed the
  button: `features/bookings/stay-window.ts` `actualStayWindow()` (pure,
  import-free) builds the new `period`, and `transition()` writes **status and
  period in ONE update** — `no_overlap` only indexes
  confirmed/checked_in/pending_verification, so a guest who overstays into the
  next booking's window still checks out; two separate updates would fail.
  A check-out at or before check-in (checked in early, left before the booked
  hour) returns null and the booked window stands — the alternative is an empty
  range that `bookings_period_valid` rejects, failing the whole check-out. The
  booked window is overwritten, so it survives in `audit_logs`
  (`scheduled_check_out` / `actual_check_out`) and the activity trail reads
  "Checked out · Late — was due 12:00". Price is untouched: no late-checkout
  charge is derived. New tests: `stay-window.test.ts` (5 unit) +
  `front-desk.test.mjs` +3 (10). **200 total** (`npm run test:db`).
- **Overnight stays are due out at 12:00 noon — DONE** (no migration). A block
  tier derived its check-out; an overnight one used whatever hour the desk
  happened to type, so the same one-night stay could end at 08:00 or 19:30 and
  a 15:00 check-out silently priced TWO nights (`ceil(25h / 24h)`). The hour is
  now the house rule, not a choice: `pricing.ts` `checkOutAtNoon()` snaps it
  **before** the nights maths, so `quote()` always returns a derived check-out
  for both kinds. Every caller sends that same snapped value to
  `fn_create_booking` — `createBooking` via `checkOutValue()` (string form:
  `"YYYY-MM-DD"` or `"…THH:mm"` → `"…T12:00"`), the portal action via
  `checkOutAtNoon()` (its form already sent noon; a hand-crafted POST need
  not) — so **no migration was needed**: the SQL runs its unchanged
  `ceil(ms/24h)` over the same window the preview priced, and the two agree by
  construction rather than by coincidence.
  _UI_: the walk-in dialog's check-out is now `type="date"` labelled
  "Check-out (12:00 noon)" with `min` = the day after arrival — offering an
  hour would be offering a choice that isn't one, and a same-day pick prices a
  night nobody sleeps. Prefill from the availability page is a datetime-local
  string, so `defaults()` slices it (`dateOnly`), and the field is parsed back
  through `checkOutValue` — `new Date("2026-08-18")` is UTC midnight, which is
  the previous day in Manila. The summary panel's "Checks out …" line now shows
  for both tier kinds. `searchAvailability` snaps each overnight tier's window
  the same way, and the free count only reuses the searched room list when the
  tier's window IS the searched one (it now falls through to `countAvailable`
  for a snapped overnight, as it already did for blocks).
  _Leaving earlier is a different fact_: the booked window stays noon and
  check-out stamps the real time over it (see the entry above). Tests are local
  wall-clock (`at()`), because "out by noon" is a wall-clock rule:
  `pricing.test.ts` +6 (11). **206 total** (`npm run test:db`).
- **Only an admin may DELETE a booking — DONE** (migration `20260817000100`).
  _The boundary was already open_: `bookings_staff_write` (migration 6) is
  `for all`, and `for all` includes DELETE — every active staff member could
  erase a booking, its payments and its proofs with one REST call. Nothing in
  the UI offered it, which is exactly why it went unnoticed: the permission
  existed and the product didn't. The policy is now split into
  `bookings_staff_insert` / `bookings_staff_update` (active staff, unchanged
  behaviour) and `bookings_admin_delete` gated on **`fn_is_admin() and
fn_is_active_user()`** — `fn_is_admin()` alone never looked at `is_active`,
  so a deactivated admin with a live JWT would have had only `proxy.ts` in the
  way. SELECT is untouched (`bookings_staff_read` already grants it).
  _Delete is NOT a tidier cancel, and the UI says so._ Cancelling keeps the row
  and takes its money out of revenue (see the cancelled-money entry above),
  which is what an inn explaining last month's figures needs; deleting is for a
  row that should never have existed — a duplicate, a test booking, a guest
  keyed twice — and it removes the booking from every report retrospectively.
  So the confirm dialog names the payment count and total it will erase and
  points at cancel instead, and `deleteBooking` (`features/bookings/actions.ts`,
  `requireRole(["admin"])`) writes a **snapshot** of the row + its payments to
  `audit_logs` first. That snapshot survives because `audit_logs.entity_id` is a
  plain uuid with **no FK to bookings** — the one record that outlives what it
  describes.
  _Three things the cascade doesn't do_: `payments` and `booking_proofs` cascade
  (RI actions bypass RLS, so no policy is needed), but the **storage objects**
  behind the proofs are reached by nothing, so the action reads their paths
  BEFORE the delete and removes them after — best-effort and logged, since the
  booking is already gone and a failure there would report one that didn't
  happen. A `checked_in` booking's room is left `occupied` by the cascade, so
  the action lands it on `cleaning`, same as check-out. And an RLS-refused
  DELETE is **zero rows, not an error**, so the action `.select("id")`s and
  treats an empty result as a refusal — otherwise front desk would be told it
  worked.
  _UI_: `BookingManageDialog` gained `canDelete` (default **false** — absent,
  not disabled, for everyone else), passed only from `/bookings` via
  `hasRole(user, "admin")`. Deliberately NOT wired into the dashboard's
  arrivals/departures: that list is a shift running its day, and an erase button
  has no business beside "check in". `BookingsTable`'s columns became
  `makeColumns(canDelete)` + `useMemo` — new column identities each render would
  reset the table's sorting and filters. Deleting can't use `runAction` (it
  re-reads the booking, which would toast "not found" over the success), so it
  closes the dialog and `router.refresh()`es the list.
  _Trap_: `.select("a, " + "b")` on a typed supabase-js client widens to plain
  `string` and the row infers as `GenericStringError` — the select list must be
  ONE string literal. New `delete-booking.test.mjs` (7 DB, mostly negative:
  front desk / anon / deactivated admin all refused with the row still there,
  front desk can still UPDATE, cascades, and the audit entry outliving the
  booking). **213 total** (`npm run test:db`).
- **The inn's clock is named, not inherited — DONE** (no migration; new
  `src/lib/inn-time.ts` + data fix `supabase/fixes/20260817_utc_shifted_booking_windows.sql`).
  _The bug_: a walk-in typed as **Aug 17, 8:17 PM** saved and displayed as
  **Aug 18, 4:17 AM** — exactly +8h. `datetime-local` inputs send a zoneless
  string, and `new Date("2026-08-17T20:17")` reads it in the **PROCESS's**
  timezone: Asia/Manila on a dev laptop, **UTC on the deployed server**. So it
  was right in `npm run dev` and eight hours wrong in production — and every
  test passed, because the tests ran on the laptop too. Reading back was never
  the problem (`parsePeriod` keeps Postgres's `+00`); the corruption was on
  WRITE.
  _Blast radius was never one field_: `checkOutValue`→`toIso` stored the noon
  check-out at **8 PM**; `checkOutAtNoon`'s `setHours(12)`, the dashboard's and
  reports' `setHours(14)`/`setHours(0)` night window, `rangeBounds`,
  `sameDay`/`startOfDay`, the calendar's day columns and `getDay()` weekend
  shading, `listFreeRooms`' availability window, the portal's future-date
  guard, and every prefilled default were all on the same inherited clock — the
  reporting "day" ran **8 AM → 8 AM**.
  _The fix is one module_: `lib/inn-time.ts` (`INN_TIME_ZONE = "Asia/Manila"`)
  with `fromInnClock` / `innTime` / `innAtHour` / `innStartOfDay` /
  `innAddDays` / `innSameDay` / `innHour` / `innWeekday` / `innDateValue` /
  `innClockValue` / `innFormatter`. The offset is read from the **zone
  database** via `Intl`, not hardcoded to +08:00 — PH has had no DST since
  1978, but that is a fact about 1978, and the two-pass inversion in `innTime`
  costs nothing and is DST-correct anyway. **Rule: no `setHours`/`getHours`/
  `getDate` on a Date meant as inn time, and no zoneless string to `new Date()`
  — route it through here.** A string that already carries a zone (`…Z`,
  `…+08:00`) is an INSTANT and is passed through untouched, which is what makes
  it safe to feed Postgres `created_at` values through the same helpers.
  _Display is pinned too_ (`innFormatter`, ~20 call sites): a device set to
  another zone must still show the hour the front desk will read out loud.
  _Import mechanics_: the pure modules (`reports.ts`, `analytics.ts`,
  `pricing.ts`, `rooms/occupancy.ts`) import it **relatively with the `.ts`
  extension** — Node's ESM resolver does no extension guessing and can't read
  the `@/*` alias — which needed `allowImportingTsExtensions` in `tsconfig.json`
  (safe: `noEmit`). That flag also cleared 10 pre-existing TS5097 errors in
  `supabase/tests/*.ts`. Everything else uses `@/lib/inn-time`.
  _Tests_: every `at()` helper built dates from PROCESS-local parts, so the
  suites measured the machine. They now build inn time. New
  `inn-time.test.ts` (17) and **`timezone-independence.mjs`** (`npm run test:tz`,
  also chained into `test:db`), which re-runs all 10 pure suites under UTC,
  Asia/Manila, America/New_York, Pacific/Kiritimati and **Australia/Lord_Howe**
  (a :30 offset WITH DST, so a whole-hour assumption fails there instead of in
  production one October). This is the test that would have caught the original
  bug. **230 total**.
  _Existing production rows are still shifted_ — the code fix doesn't move
  them. `supabase/fixes/20260817_utc_shifted_booking_windows.sql` is a
  three-step, roll-back-able script (deliberately NOT a migration: it describes
  damage to ONE database, and on a fresh local stack it would corrupt correct
  data). It fingerprints shifted rows by the house rule — an overnight stay not
  due out at 12:00 wasn't written on the inn's clock — which also makes it
  idempotent, since after the fix the fingerprint stops matching. Two
  populations: ordinary rows move both ends, but a **`checked_out` row's upper
  bound was stamped by `actualStayWindow` from `new Date()`, an absolute
  instant that was always correct**, so only its check-in moves. **Block
  bookings cannot be fingerprinted at all** (check-out is just check-in +
  duration, so a shifted row is indistinguishable from an ordinary one) and are
  left for manual correction by reference code — guessing would put guests in
  the wrong room at the wrong hour. Money is untouched throughout:
  `payments.created_at` is `now()`, and `quoted_total` was computed from a
  window shifted at both ends, so the night count and the price are what the
  guest agreed to.
