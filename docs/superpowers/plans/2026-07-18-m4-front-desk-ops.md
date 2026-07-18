# Travelers Inn — M4 Front Desk Operations Implementation Plan

> **For agentic workers:** Execute task-by-task (superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the front desk the daily tools: check-in / check-out / no-show, recording payments (with derived payment status), reassigning a booking to another free room, and a room × date availability calendar.

**Architecture:** A `booking.payments` table with an AFTER trigger that keeps `bookings.payment_status` in sync (unpaid/partial/paid). Booking lifecycle transitions run through server actions that also sync the assigned room's housekeeping status (check-in → occupied, check-out → cleaning). Room reassignment updates `bookings.room_id`, relying on the existing `no_overlap` exclusion constraint for safety, and offers only genuinely-free rooms via a new `fn_available_rooms`. A booking **manage dialog** hosts all of this; a calendar page renders occupancy as a rooms-by-days grid.

**Tech Stack:** As M3.

## Global Constraints

(Inherits all prior — see `CLAUDE.md`.) Key: schema `booking`; base-nova `render` not `asChild`; mutations via server actions (`requireRole(["admin","front_desk"])` → Zod → repository/RPC → `logAudit` → `revalidatePath` → `ActionResult`); coerced-number forms use `useForm<FormValues, unknown, Input>`; Node 22; local stack 546xx; `set -a; . ./.env.local; set +a` before `db:*`; RPC args with no SQL default are non-nullable in generated types (pass `""`, let SQL `nullif`).

---

### Task 1: Migration 8 — payments + status trigger; Migration 9 — fn_available_rooms

**Files:**
- Create: `supabase/migrations/20260718000800_payments.sql`
- Create: `supabase/migrations/20260718000900_available_rooms.sql`

**Interfaces:**
- Produces: enum `booking.payment_method`; table `booking.payments`; trigger `booking.fn_sync_payment_status()`; function `booking.fn_available_rooms(p_room_type_id uuid, p_check_in timestamptz, p_check_out timestamptz, p_exclude_booking uuid) returns setof booking.rooms`.

- [ ] **Step 1:** Write migration 8:
```sql
create type booking.payment_method as enum ('cash', 'gcash', 'card', 'bank_transfer', 'other');

create table booking.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references booking.bookings (id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0),
  method booking.payment_method not null default 'cash',
  reference text,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_booking_id_idx on booking.payments (booking_id);

alter table booking.payments enable row level security;
create policy payments_staff_read on booking.payments for select
  using (booking.fn_is_active_user());
create policy payments_staff_write on booking.payments for all
  using (booking.fn_is_active_user())
  with check (booking.fn_is_active_user());

-- Keep bookings.payment_status derived from the sum of payments.
create or replace function booking.fn_sync_payment_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_booking uuid := coalesce(new.booking_id, old.booking_id);
  v_paid numeric(10,2);
  v_total numeric(10,2);
begin
  select coalesce(sum(amount), 0) into v_paid from booking.payments where booking_id = v_booking;
  select quoted_total into v_total from booking.bookings where id = v_booking;
  update booking.bookings set payment_status =
    case when v_total is null then 'unpaid'
         when v_paid >= v_total and v_paid > 0 then 'paid'
         when v_paid > 0 then 'partial'
         else 'unpaid' end
  where id = v_booking;
  return null;
end;
$$;

create trigger sync_payment_status
  after insert or update or delete on booking.payments
  for each row execute function booking.fn_sync_payment_status();
```
- [ ] **Step 2:** Write migration 9:
```sql
-- Rooms of a type that are free in a window, optionally ignoring one booking
-- (used when reassigning that booking to a different room).
create or replace function booking.fn_available_rooms(
  p_room_type_id uuid,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_exclude_booking uuid default null
) returns setof booking.rooms language sql stable security definer set search_path = '' as $$
  select r.* from booking.rooms r
  where r.room_type_id = p_room_type_id
    and r.status <> 'out_of_service'
    and not exists (
      select 1 from booking.bookings b
      where b.room_id = r.id
        and b.status in ('confirmed', 'checked_in')
        and (p_exclude_booking is null or b.id <> p_exclude_booking)
        and b.period && tstzrange(p_check_in, p_check_out, '[)')
    )
  order by r.label;
$$;
grant execute on function booking.fn_available_rooms(uuid, timestamptz, timestamptz, uuid) to authenticated;
```
- [ ] **Step 3:** `supabase db reset && npm run db:types && npm run build` — Expected: PASS. Commit.

---

### Task 2: Payment schema + repository additions

**Files:**
- Create: `src/features/bookings/payment-schema.ts`
- Modify: `src/features/bookings/repository.ts`

**Interfaces:**
- Produces: `paymentSchema`, `PaymentFormValues`, `PaymentInput`, `PAYMENT_METHOD_LABELS`; `listPayments(bookingId)`, `getBookingWithPayments(id)`, `listAvailableRooms(roomTypeId, checkIn, checkOut, excludeBooking)`; `sumPaid(payments)`.

- [ ] **Step 1:** `payment-schema.ts`:
```ts
import { z } from "zod";
export const PAYMENT_METHODS = ["cash", "gcash", "card", "bank_transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash", gcash: "GCash", card: "Card", bank_transfer: "Bank transfer", other: "Other",
};
export const paymentSchema = z.object({
  booking_id: z.string().uuid(),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(80).optional().or(z.literal("")),
});
export type PaymentFormValues = z.input<typeof paymentSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
```
- [ ] **Step 2:** In `repository.ts` add: `Payment` type; `listPayments(bookingId)` (ordered by created_at); `getBookingWithPayments(id)` (booking + payments[] + `paid` sum); `listAvailableRooms(...)` via `rpc("fn_available_rooms", …)` returning `{ id, label }[]`. Export `sumPaid(payments): number`.
- [ ] **Step 3:** `npm run build` — Expected: PASS. Commit.

---

### Task 3: Front-desk actions + DB test

**Files:**
- Create: `src/features/bookings/front-desk-actions.ts`
- Create: `supabase/tests/front-desk.test.mjs`; add to `test:db`

**Interfaces:**
- Produces: `checkIn(id)`, `checkOut(id)`, `markNoShow(id)`, `recordPayment(input)`, `reassignRoom(bookingId, roomId)` — all `ActionResult`.

- [ ] **Step 1:** Write `front-desk.test.mjs`: recording a partial payment sets `payment_status='partial'`; paying the remainder sets `'paid'`; a booking's status transitions confirmed→checked_in→checked_out via direct updates leave data consistent; `fn_available_rooms` excludes the booked room but **includes it when that same booking is the excluded one**; reassigning to a truly-free room succeeds and to an occupied room raises the exclusion violation.
- [ ] **Step 2:** Run it — Expected: FAIL then iterate to PASS against the real DB objects (trigger + fn from Task 1).
- [ ] **Step 3:** Write `front-desk-actions.ts`:
  - `checkIn(id)`: guard → load booking → require status `confirmed` → update to `checked_in` → set its room `occupied` → audit → revalidate.
  - `checkOut(id)`: require `checked_in` → update to `checked_out` → set room `cleaning` → audit → revalidate.
  - `markNoShow(id)`: require `confirmed` → update to `no_show` → audit → revalidate.
  - `recordPayment(input)`: `paymentSchema.parse` → insert into `payments` with `recorded_by` → audit → revalidate (`payment_status` synced by trigger).
  - `reassignRoom(bookingId, roomId)`: update `bookings.room_id`; on `exclusion_violation`/error return "That room is no longer free." → audit → revalidate.
  Guard all with `requireRole(["admin","front_desk"])`. Revalidate `/bookings` and `/calendar`.
- [ ] **Step 4:** `supabase db reset && node supabase/tests/front-desk.test.mjs` — Expected: PASS. Add to `test:db`.
- [ ] **Step 5:** `npm run build` — Expected: PASS. Commit.

---

### Task 4: Booking manage dialog (check-in/out, payment, reassign)

**Files:**
- Create: `src/features/bookings/components/booking-manage-dialog.tsx`
- Create: `src/features/bookings/components/record-payment-form.tsx`
- Create: `src/features/bookings/components/reassign-room-select.tsx`
- Modify: `src/features/bookings/components/bookings-table.tsx` (row action "Manage")
- Modify: `src/app/(app)/bookings/page.tsx` (pass payments/available rooms as needed)

**Interfaces:**
- Consumes: `getBookingWithPayments` (server, via the page or a server action), `checkIn/checkOut/markNoShow/recordPayment/reassignRoom`, `listAvailableRooms`.

- [ ] **Step 1:** Add a server action `loadBookingDetail(id)` (in `front-desk-actions.ts` or a small `detail-actions.ts`) returning `{ booking, payments, paid, availableRooms }` for the dialog to fetch on open (keeps the list page light). Guard with `requireRole`.
- [ ] **Step 2:** `record-payment-form.tsx` ("use client"): RHF + `paymentSchema` (hidden `booking_id`), `FormInput` amount (number) + `FormSelect` method + `FormInput` reference; shows balance due; submit → `recordPayment` → toast → refresh detail.
- [ ] **Step 3:** `reassign-room-select.tsx` ("use client"): a `Select` of `availableRooms` (label) → on choose calls `reassignRoom` → toast/refresh.
- [ ] **Step 4:** `booking-manage-dialog.tsx` ("use client"): opens from the table; on open calls `loadBookingDetail`; header shows guest + ref + status badge; a summary (room, dates, stay type, total, paid, balance, payment badge); action buttons gated by status (Check in / Check out / Mark no-show) via `ConfirmDialog`; the payment form + payment history list; the reassign select (only when status is `confirmed`/`checked_in`). Each action refreshes the detail and calls `router.refresh()`.
- [ ] **Step 5:** In `bookings-table.tsx`, add a "Manage" row action opening the dialog (replaces/augments the cancel-only menu; keep Cancel inside the dialog too).
- [ ] **Step 6:** `npm run build && npm run lint` — Expected: PASS. Commit.

---

### Task 5: Availability calendar (rooms × dates)

**Files:**
- Create: `src/app/(app)/calendar/page.tsx`
- Create: `src/features/bookings/components/calendar-grid.tsx`
- Create: `src/features/bookings/calendar.ts` (server data shaping)

**Interfaces:**
- Consumes: rooms (with type) + bookings overlapping the visible range.
- Produces: `buildCalendar(startDate, days, rooms, bookings) → { days: Date[]; rows: {...} }`.

- [ ] **Step 1:** `calendar.ts`: pure function that, for a start date + N days (default 14) + rooms + active bookings, produces per-room per-day cells marking occupancy. A day is occupied for a room if any active booking on that room overlaps `[day 00:00, next day 00:00)`. Each cell carries the booking's `guest_name`, `status`, and whether it's the booking's first visible day (for label placement).
- [ ] **Step 2:** `calendar-grid.tsx` ("use client" for the date-range nav): sticky room column, day columns with weekday/date headers, occupied cells filled (color by status: confirmed vs checked_in) with the guest name on the start day; a prev/next week control that updates a `?start=YYYY-MM-DD` search param. Horizontal scroll wrapper (`overflow-x-auto`).
- [ ] **Step 3:** `calendar/page.tsx` (RSC): `requireRole(["admin","front_desk"])`; read `?start` (async searchParams) default today; fetch rooms (with type) and bookings whose `period` overlaps the window (`fn`-free: filter in the query by `lower(period) < window_end` and `upper(period) > window_start` — do it in JS from `listBookings()` for simplicity, or add a ranged repository query); render `CalendarGrid`. Show `EmptyState` if no rooms.
- [ ] **Step 4:** `npm run build && npm run lint` — Expected: PASS. Commit.

---

### Task 6: Seed front-desk demo state + verify

**Files:**
- Modify: `supabase/seed.sql`

- [ ] **Step 1:** In `seed.sql`, after the demo bookings, record a partial payment for one booking and mark another `checked_in` (with its room `occupied`) so the dialog, badges, and calendar show varied states. Guard with the existing `not exists` bookings check / a fresh guard so re-runs stay idempotent.
- [ ] **Step 2:** `supabase db reset` — Expected: PASS; verify counts via REST (`payments`, a `checked_in` booking).
- [ ] **Step 3:** `npm run test:db` — Expected: all suites PASS.
- [ ] **Step 4:** Playwright (mint admin session): open `/bookings`, open the manage dialog on a booking, record a payment (see balance update + badge → partial/paid), check the guest in; open `/calendar` and screenshot the occupancy grid. Verify visually.
- [ ] **Step 5:** `npm run build && npm run lint`. Commit.

---

## Self-Review

- **Spec coverage:** check-in/out flow + room-status side effects (Task 3 actions, Task 4 dialog); payments with derived status (Task 1 trigger, Task 3 `recordPayment`, Task 4 form); room reassignment (Task 1 `fn_available_rooms`, Task 3 `reassignRoom`, Task 4 select); availability calendar (Task 5). No-show handled (Task 3) and frees the room via the existing exclusion `WHERE`.
- **Placeholders:** none — SQL (payments table, trigger, `fn_available_rooms`) and schema are concrete; component tasks name exact files, props, gating, and shared primitives.
- **Type consistency:** `payment_method` enum aligns across migration, `PAYMENT_METHODS`, and labels. `fn_available_rooms` and `fn_sync_payment_status` names are referenced identically in repository/actions/tests. Status-gating strings (`confirmed`/`checked_in`/`checked_out`/`no_show`) match `BOOKING_STATUSES` from M3. Actions revalidate both `/bookings` and `/calendar`.
