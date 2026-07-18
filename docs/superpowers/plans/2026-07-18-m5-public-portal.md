# Travelers Inn — M5 Public Booking Portal Implementation Plan

> **For agentic workers:** Execute task-by-task (superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax.

**Goal:** A polished, public (no-login) booking site where guests search availability for their dates, see room types + prices, enter contact details, and get an **auto-confirmed** booking with a reference code — reusing the M3 booking engine.

**Architecture:** A new `(portal)` route group with its own marketing-style layout (no staff sidebar). The portal never touches booking tables directly: a public server action `createPortalBooking` validates input and invokes `fn_create_booking` (source `portal`) through the **service-role admin client**, so the SECURITY DEFINER function stays off the `anon` grant list and every portal mutation passes through one validated, server-side path. Availability + prices are computed server-side (admin client + `fn_count_available` + the existing `quote()` util). Room types are already public-readable.

**Tech Stack:** As M4. Portal UI applies the `frontend-design` skill for a distinctive public-facing look.

## Global Constraints

(Inherits all prior — see `CLAUDE.md`.) Key: schema `booking`; base-nova `render` not `asChild` (+ `nativeButton={false}` when a Button renders a Link); coerced-number forms use `useForm<FormValues, unknown, Input>`; Node 22; local stack 546xx; `set -a; . ./.env.local; set +a` before `db:*`; the admin client is server-only. Portal accepts the design's no-deposit / no-show risk (payment recorded later by staff).

---

### Task 1: Portal booking action + availability + DB test

**Files:**
- Create: `src/features/portal/schemas.ts`, `src/features/portal/repository.ts`, `src/features/portal/actions.ts`
- Create: `supabase/tests/portal.test.mjs`; add to `test:db`

**Interfaces:**
- Produces: `portalBookingSchema`, `PortalBookingInput`; `listPortalAvailability(checkIn, checkOut, stayType) → AvailabilityOption[]`; `createPortalBooking(input) → ActionResult<{ reference_code }>`.

- [ ] **Step 1:** `schemas.ts`:
```ts
import { z } from "zod";
export const portalBookingSchema = z.object({
  guest_name: z.string().trim().min(1, "Please enter your name").max(120),
  guest_phone: z.string().trim().min(7, "Please enter a contact number").max(40),
  guest_email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  room_type_id: z.string().uuid(),
  stay_type: z.enum(["nightly", "hourly"]),
  check_in: z.string().min(1),
  check_out: z.string().min(1),
});
export type PortalBookingInput = z.infer<typeof portalBookingSchema>;
```
- [ ] **Step 2:** `repository.ts`: `AvailabilityOption = { id, name, description, capacity, available, units, total, unitLabel }`. `listPortalAvailability(checkInISO, checkOutISO, stayType)` uses the **admin client**: fetch active room_types; for each, `rpc("fn_count_available", …)` and `quote(stayType, …rates)`; skip hourly types with no `hourly_rate`; return options (include zero-availability so the UI can show "fully booked"). Also `getRoomTypePublic(id)` for the booking step.
- [ ] **Step 3:** `actions.ts` (`"use server"`, **no auth guard** — public): `createPortalBooking(input)`:
  - `portalBookingSchema.parse`.
  - Convert `check_in/out` (datetime-local) → Date. Guard: `check_in` not in the past (>= start of today) → "Please choose a future date."; nightly stay ≤ 30 nights, hourly ≤ 24 hours → "Please contact us for long stays."
  - `createAdminClient().rpc("fn_create_booking", { …, p_source: "portal" })`; on error surface the function's message (availability/hourly/period). Return `ok({ reference_code })`. `revalidatePath("/")`, `revalidatePath("/bookings")`, `revalidatePath("/calendar")`.
- [ ] **Step 4:** `portal.test.mjs`: a portal booking via the same engine records `source='portal'` and `status='confirmed'`; booking a fully-booked type returns the no-availability error. (Reuse `_helpers.mjs`; call `fn_create_booking` with `p_source='portal'` as the admin/service client.)
- [ ] **Step 5:** `supabase db reset && node supabase/tests/portal.test.mjs` — PASS. Add to `test:db`. `npm run build` — PASS. Commit.

---

### Task 2: Portal layout + home (search + results)

> Apply the **frontend-design** skill for this task — the portal is the public face; give it a distinctive, warm, hospitality look (not the staff operational UI).

**Files:**
- Delete: `src/app/page.tsx` (the old redirect-to-login root)
- Create: `src/app/(portal)/layout.tsx`, `src/app/(portal)/page.tsx`
- Create: `src/features/portal/components/{search-bar.tsx,room-type-card.tsx,room-visual.tsx}`

**Interfaces:**
- Consumes: `listPortalAvailability`; search params `checkIn/checkOut/stay`.

- [ ] **Step 1:** `(portal)/layout.tsx`: a clean public shell — top bar with the Travelers Inn wordmark + a subtle "Staff sign in" link to `/login`; a footer. No sidebar. Theme-aware.
- [ ] **Step 2:** `room-visual.tsx`: a deterministic gradient/pattern block keyed off the room type name (we have no photos yet) with the type name — gives each card a distinct visual identity.
- [ ] **Step 3:** `search-bar.tsx` ("use client"): check-in date, check-out date (date inputs), stay type (nightly/hourly) → on submit pushes `/?checkIn=…&checkOut=…&stay=…`. Sensible defaults (tonight → tomorrow). For nightly, dates become 14:00 / 12:00; for hourly, expose time inputs.
- [ ] **Step 4:** `room-type-card.tsx`: visual + name + description + capacity + price line (`peso`), and a "Book" button (disabled + "Fully booked" when `available === 0`) that links/opens the booking step for that type + dates.
- [ ] **Step 5:** `(portal)/page.tsx` (RSC): hero section (headline, the search bar); when `checkIn/checkOut` present, call `listPortalAvailability` and render the result cards; otherwise a welcoming default (featured room types with nightly-from prices via a today+1 quote). Handle async `searchParams`.
- [ ] **Step 6:** `npm run build && npm run lint` — PASS. Commit.

---

### Task 3: Booking step + confirmation

**Files:**
- Create: `src/app/(portal)/book/page.tsx`, `src/app/(portal)/book/confirmation.tsx` (client) or inline
- Create: `src/features/portal/components/portal-booking-form.tsx`

**Interfaces:**
- Consumes: `getRoomTypePublic`, `listPortalAvailability` (to re-verify), `createPortalBooking`.

- [ ] **Step 1:** `book/page.tsx` (RSC): reads `?type&checkIn&checkOut&stay` (async searchParams); loads the room type + re-checks availability + price; shows a summary (room type, dates, nights/hours, total) and the `PortalBookingForm`. If unavailable, show a friendly "just booked out" message with a link back to search.
- [ ] **Step 2:** `portal-booking-form.tsx` ("use client"): RHF + `portalBookingSchema` (hidden type/dates/stay), fields name/phone/email; submit → `createPortalBooking`; on success set local `confirmed` state showing the **reference code**, guest name, room type, dates, total, and a "what's next" note (pay at the front desk on arrival); on failure toast the message (e.g. fully booked) and offer back-to-search.
- [ ] **Step 3:** Confirmation view: a clean success card with the reference code prominent; a "Book another stay" link to `/`.
- [ ] **Step 4:** `npm run build && npm run lint` — PASS. Commit.

---

### Task 4: Verify (portal end-to-end) + polish

**Files:**
- Modify (if needed): portal components for responsiveness/theme.

- [ ] **Step 1:** `supabase db reset` (re-seed). `npm run test:db` — all suites PASS.
- [ ] **Step 2:** Playwright (no auth needed — portal is public): open `/`, run a search for two nights, see availability cards with prices; click Book on an available type; fill guest details; submit; see the confirmation with a reference code. Screenshot home + confirmation.
- [ ] **Step 3:** Cross-check: the new portal booking appears in the staff `/bookings` list with source shown and status `confirmed` (mint an admin session as in prior milestones). Screenshot.
- [ ] **Step 4:** Verify the booked room is now unavailable for the same dates on a repeat portal search (availability decremented). 
- [ ] **Step 5:** `npm run build && npm run lint`. Commit.

---

## Self-Review

- **Spec coverage:** public no-login portal (`(portal)` group, no guest auth); search availability + prices (`listPortalAvailability`); book with contact details (`portal-booking-form`); **auto-confirm if available** (`fn_create_booking` source `portal`, status defaults `confirmed`); confirmation with reference code (Task 3). Reuses the M3 engine and its exclusion-constraint safety unchanged.
- **Security:** `fn_create_booking`/`fn_count_available` are NOT granted to `anon`; the portal reaches them only through server-side code using the admin client, behind Zod validation + future-date/max-stay guards. Room-type reads use the public-read RLS already in place. No booking data is exposed to guests beyond their own confirmation.
- **Placeholders:** none — schema, action guards, and availability shaping are concrete; UI tasks name exact files and the frontend-design application point.
- **Type consistency:** `stay_type`/pricing reuse `quote()` and the M3 `StayType`; `createPortalBooking` passes `p_source: "portal"` matching `booking.booking_source`; portal action returns `ActionResult<{ reference_code }>` consumed by the form.
