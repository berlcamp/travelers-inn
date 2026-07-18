# Travelers Inn — Booking & Reservation Management System — Design

**Date:** 2026-07-18
**Status:** Approved (design) — proceeding to implementation

## 1. Summary

A two-surface web app on the prime-hrm stack (Next 16, Supabase custom schema
`booking`, Base UI / shadcn `base-nova`, Tailwind 4, server actions + repository
pattern):

- **`(app)` — internal staff tools** (Google login, admin-invited): manage room
  types / rooms / rates, reservations, walk-ins, availability calendar,
  check-in/out, reports.
- **`(portal)` — public booking site** (no login): browse availability, book a
  room type with contact details, **auto-confirmed if a room is free**.

## 2. Stack & shared-Supabase constraints (inherited from prime-hrm)

- **Custom schema `booking`** — every object lives there, never `public`.
  Clients pre-bound via `{ db: { schema: "booking" } }`.
- **Shared `auth.users`** (same Supabase project as prime-hrm): NO triggers on
  `auth.users`, NO project-wide auth hooks, always `signOut({ scope: "local" })`.
  Staff access via a **profile-based invite gate** (`booking.fn_claim_invitation()`
  invoked on the auth callback), mirroring prime-hrm.
- Migrations `supabase/migrations/NNN_*.sql`, objects on shared surfaces prefixed
  `booking_`, applied to the hosted DB manually by the user; each logged as we go.
- Next 16 `proxy.ts` (not middleware.ts), async `cookies()/headers()/params/searchParams`.
- Local stack via Colima + Supabase CLI devDependency; local GoTrue uses password
  auth for tests (Google needs real creds). Node ≥ 22 required.

## 3. Data model (schema `booking`)

| Table | Purpose |
|---|---|
| `profiles` | staff identity (id → auth.users), full_name, email, avatar_url, is_active |
| `user_roles` | role per staff: `admin` \| `front_desk` |
| `invitations` | admin-whitelisted emails + claim status (invite gate) |
| `room_types` | name, description, capacity, `nightly_rate`, `hourly_rate`, photos, is_active |
| `rooms` | physical room (number/label) → room_type, status: `vacant`\|`occupied`\|`cleaning`\|`out_of_service` |
| `bookings` | the reservation (see below) |
| `payments` | per-booking records: amount, method (cash/…), status, recorded_by |
| `audit_log` | who did what (reuse prime-hrm's `logAudit` pattern) |

### `bookings` core columns

- `guest_name`, `guest_phone`, `guest_email` (embedded — no guest accounts)
- `room_type_id`, `room_id` (assigned physical room)
- `stay_type`: `nightly` | `hourly`
- `period` — **`tstzrange`** (check-in ts → check-out ts), unified for both stay types
- `status`: `confirmed` | `checked_in` | `checked_out` | `cancelled` | `no_show`
- `source`: `portal` | `walk_in` | `staff`
- `quoted_total` (computed at booking: nights × nightly_rate, or hours → hourly_rate)
- `payment_status`: `unpaid` | `partial` | `paid` (derived from `payments`)
- `reference_code` (short human code shown on portal confirmation)
- timestamps, `created_by`

## 4. Double-booking guarantee (key design choice)

Prevent overlaps at the **database layer**, not just app code:

```sql
ALTER TABLE booking.bookings
  ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (room_id WITH =, period WITH &&)
  WHERE (status IN ('confirmed','checked_in'));
```

Booking flow (portal auto-confirm, walk-in, staff): pick room type + period →
query rooms of that type with no overlapping active booking → **auto-assign the
first free room** → insert. Concurrent requests racing for the last room: the
exclusion constraint makes one fail cleanly → return "just booked, pick another."
Handles nightly + hourly uniformly and is race-safe. Staff can **reassign** a
booking to another free room (same constraint protects it).

## 5. Surfaces & routes

**Internal `(app)`** (role-guarded via `requireRole`):

- `/dashboard` — arrivals/departures today, occupancy %, revenue
- `/calendar` — room × date grid showing bookings (availability calendar)
- `/bookings` — TanStack table (list/filter), detail drawer, confirm/cancel/no-show,
  reassign room, **walk-in quick-book** dialog, check-in / check-out actions
- `/rooms` — rooms + statuses (housekeeping updates)
- `/room-types` — CRUD + rates *(admin)*
- `/users` — invite staff, manage roles *(admin)*

**Public `(portal)`**:

- `/` — search: dates (or hourly slot), guests → available room types + prices
- `/book` — pick type, enter contact details, submit → auto-confirm → confirmation
  page with reference code

## 6. Conventions (mirrored from prime-hrm)

- **Mutations** only via server actions: `"use server"` → `requireRole()` guard →
  Zod parse (schema shared with form) → repository → `logAudit()` →
  `revalidatePath()` → `ActionResult<T>`.
- **Reads** via `features/<module>/repository.ts` on the RLS-scoped server client;
  `admin.ts` client only where RLS can't express a rule (portal availability +
  insert run through a controlled server action / `SECURITY DEFINER` fn).
- **RLS**: staff tables scoped by role; `rooms`/`room_types` publicly *readable*
  (portal needs availability) but writable only by staff; `bookings` insertable via
  the portal path through a validated action; no public read of others' bookings.
- Every list page composes `components/shared/data-table.tsx`. Forms use Base UI
  Field wrappers (`components/shared/form-fields.tsx`).
- `frontend-design` skill applied to both surfaces (staff = dense operational UI;
  portal = polished public-facing).

## 7. Testing

- **DB/integration**: `supabase/tests/*.mjs` harnesses against the real local stack
  (`npm run db:reset`) — overlap/exclusion-constraint tests, pricing math,
  availability, check-in/out, invite claim.
- **RLS persona assertions** for role scoping.
- **Playwright** E2E: portal search→book→confirm; staff walk-in→check-in→check-out→payment.
- `npm run lint && npm run build` + route smoke test before closing each milestone.

## 8. Decisions / defaults

- Guests cannot cancel their own portal booking (no login → staff cancels on request).
- Hourly bookings use start time + duration picker.
- `no_show` is a manual staff status.
- First invited user is the admin/owner.

## 9. Milestones (each ships independently)

1. **M1 Foundation** — scaffold, supabase clients, `booking` schema,
   profiles/roles/invitations, Google auth + invite gate, app shell + login.
2. **M2 Rooms & rates** — room_types/rooms CRUD, statuses, admin.
3. **M3 Bookings core** — bookings table + exclusion constraint, availability query,
   pricing, walk-in quick-book, list/detail.
4. **M4 Front desk ops** — calendar grid, check-in/out, payments, room reassignment.
5. **M5 Public portal** — search, book, auto-confirm, confirmation.
6. **M6 Reports/dashboard** — occupancy, revenue, arrivals/departures.
