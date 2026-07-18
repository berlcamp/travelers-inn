# Travelers Inn — M3 Bookings Core Implementation Plan

> **For agentic workers:** Execute task-by-task (superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Create bookings with a database-guaranteed no-double-booking rule, nightly/hourly pricing, availability lookup, walk-in quick-book, and a bookings list/detail.

**Architecture:** A `booking.bookings` table stores each stay as a `tstzrange` against an assigned `room_id`, protected by a GiST **exclusion constraint** (`btree_gist`) so overlapping active bookings are impossible at the DB layer. A `SECURITY DEFINER` function `fn_create_booking()` computes the authoritative price from the room type's rates, auto-assigns the first free room of the requested type, and inserts atomically (retrying on the exclusion violation). Staff create bookings through a server action that calls this function; the M5 portal will reuse it.

**Tech Stack:** As M2. New: Postgres `btree_gist`, `tstzrange`, GiST exclusion constraint, plpgsql functions.

## Global Constraints

(Inherits all prior — see `CLAUDE.md`.) Key: schema `booking`; base-nova `render` not `asChild`; mutations via server actions (`requireRole` → Zod → repository/RPC → `logAudit` → `revalidatePath` → `ActionResult`); coerced-number forms use `useForm<FormValues (z.input), unknown, Input (z.infer)>`; Node 22; local stack 546xx; `set -a; . ./.env.local; set +a` before `db:*`.

---

### Task 1: Migration 6 — bookings table + exclusion constraint + RLS

**Files:**
- Create: `supabase/migrations/20260718000600_bookings.sql`

**Interfaces:**
- Produces: enums `booking.booking_status`, `booking.stay_type`, `booking.booking_source`, `booking.payment_status`; function `booking.gen_reference_code()`; table `booking.bookings` with `no_overlap` exclusion constraint; RLS (staff read/write, no public read).

- [ ] **Step 1:** Write migration:
```sql
create extension if not exists btree_gist with schema extensions;

create type booking.booking_status as enum
  ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');
create type booking.stay_type as enum ('nightly', 'hourly');
create type booking.booking_source as enum ('portal', 'walk_in', 'staff');
create type booking.payment_status as enum ('unpaid', 'partial', 'paid');

-- Short human-friendly code, e.g. TI-9F3A2C.
create or replace function booking.gen_reference_code()
returns text language sql volatile as $$
  select 'TI-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
$$;

create table booking.bookings (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique default booking.gen_reference_code(),
  guest_name text not null,
  guest_phone text,
  guest_email text,
  room_type_id uuid not null references booking.room_types (id) on delete restrict,
  room_id uuid not null references booking.rooms (id) on delete restrict,
  stay_type booking.stay_type not null,
  period tstzrange not null,
  status booking.booking_status not null default 'confirmed',
  source booking.booking_source not null default 'staff',
  quoted_total numeric(10, 2) not null check (quoted_total >= 0),
  payment_status booking.payment_status not null default 'unpaid',
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_period_valid check (not isempty(period) and lower(period) < upper(period))
);

-- The double-booking guarantee: no two ACTIVE bookings on the same room overlap.
alter table booking.bookings
  add constraint no_overlap
  exclude using gist (room_id with =, period with &&)
  where (status in ('confirmed', 'checked_in'));

create index bookings_room_period_idx on booking.bookings using gist (room_id, period);
create index bookings_status_idx on booking.bookings (status);
create index bookings_room_type_idx on booking.bookings (room_type_id);
create index bookings_period_lower_idx on booking.bookings (lower(period));

create trigger set_updated_at before update on booking.bookings
  for each row execute function booking.set_updated_at();

alter table booking.bookings enable row level security;

-- Staff only: no public read (a guest must not list others' bookings). The M5
-- portal creates bookings through fn_create_booking (SECURITY DEFINER), not via
-- direct table access.
create policy bookings_staff_read on booking.bookings for select
  using (booking.fn_is_active_user());
create policy bookings_staff_write on booking.bookings for all
  using (booking.fn_is_active_user())
  with check (booking.fn_is_active_user());
```
- [ ] **Step 2:** `set -a; . ./.env.local; set +a; ./node_modules/.bin/supabase db reset` — Expected: PASS.
- [ ] **Step 3:** `npm run db:types && npm run build` — Expected: PASS.
- [ ] **Step 4:** Commit.

---

### Task 2: Migration 7 — booking functions (availability + create)

**Files:**
- Create: `supabase/migrations/20260718000700_booking_functions.sql`

**Interfaces:**
- Produces: `booking.fn_count_available(p_room_type_id uuid, p_check_in timestamptz, p_check_out timestamptz) returns int`; `booking.fn_create_booking(...) returns booking.bookings` (raises `no_availability` / `invalid_period` / `hourly_unavailable`).

- [ ] **Step 1:** Write functions:
```sql
-- Rooms of a type with no overlapping active booking in the window.
create or replace function booking.fn_count_available(
  p_room_type_id uuid, p_check_in timestamptz, p_check_out timestamptz
) returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from booking.rooms r
  where r.room_type_id = p_room_type_id
    and r.status <> 'out_of_service'
    and not exists (
      select 1 from booking.bookings b
      where b.room_id = r.id
        and b.status in ('confirmed', 'checked_in')
        and b.period && tstzrange(p_check_in, p_check_out, '[)')
    );
$$;

-- Auto-assign the first free room of the type and insert atomically. Price is
-- computed here (authoritative) from the type's rates — never trusted from the
-- caller. Retries across rooms on the exclusion-constraint race.
create or replace function booking.fn_create_booking(
  p_guest_name text,
  p_guest_phone text,
  p_guest_email text,
  p_room_type_id uuid,
  p_stay_type booking.stay_type,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_source booking.booking_source,
  p_notes text default null
) returns booking.bookings language plpgsql security definer set search_path = '' as $$
declare
  v_type booking.room_types;
  v_period tstzrange := tstzrange(p_check_in, p_check_out, '[)');
  v_units int;
  v_total numeric(10,2);
  v_room record;
  v_booking booking.bookings;
begin
  if p_check_out <= p_check_in then
    raise exception 'invalid_period' using message = 'Check-out must be after check-in.';
  end if;

  select * into v_type from booking.room_types where id = p_room_type_id and is_active;
  if v_type.id is null then
    raise exception 'inactive_type' using message = 'That room type is not bookable.';
  end if;

  if p_stay_type = 'nightly' then
    v_units := greatest(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 86400.0)::int);
    v_total := v_units * v_type.nightly_rate;
  else
    if v_type.hourly_rate is null then
      raise exception 'hourly_unavailable' using message = 'This room type has no hourly rate.';
    end if;
    v_units := greatest(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 3600.0)::int);
    v_total := v_units * v_type.hourly_rate;
  end if;

  for v_room in
    select r.id from booking.rooms r
    where r.room_type_id = p_room_type_id
      and r.status <> 'out_of_service'
      and not exists (
        select 1 from booking.bookings b
        where b.room_id = r.id
          and b.status in ('confirmed', 'checked_in')
          and b.period && v_period
      )
    order by r.label
  loop
    begin
      insert into booking.bookings
        (guest_name, guest_phone, guest_email, room_type_id, room_id, stay_type,
         period, source, quoted_total, notes, created_by)
      values
        (p_guest_name, nullif(p_guest_phone, ''), nullif(p_guest_email, ''),
         p_room_type_id, v_room.id, p_stay_type, v_period, p_source, v_total,
         nullif(p_notes, ''), (select auth.uid()))
      returning * into v_booking;
      return v_booking;
    exception when exclusion_violation then
      -- Lost the race for this room; try the next one.
      continue;
    end;
  end loop;

  raise exception 'no_availability' using message = 'No rooms of that type are free for those dates.';
end;
$$;

grant execute on function booking.fn_count_available(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function booking.fn_create_booking(
  text, text, text, uuid, booking.stay_type, timestamptz, timestamptz, booking.booking_source, text
) to authenticated;
```
- [ ] **Step 2:** `supabase db reset` — Expected: PASS.
- [ ] **Step 3:** `npm run db:types && npm run build` — Expected: PASS. Commit.

---

### Task 3: Pricing util + schemas + repository

**Files:**
- Create: `src/features/bookings/pricing.ts`, `src/features/bookings/schemas.ts`, `src/features/bookings/repository.ts`

**Interfaces:**
- Produces: `quote(stayType, checkIn, checkOut, nightlyRate, hourlyRate) → { units, total }`; `bookingSchema`, `BookingFormValues`, `BookingInput`, `BOOKING_STATUS_LABELS`; `listBookings(filter?)`, `getBooking(id)`.

- [ ] **Step 1:** `pricing.ts` — mirrors the SQL math for a live form preview:
```ts
import type { RoomStatus } from "@/features/rooms/schemas";

export type StayType = "nightly" | "hourly";

export function quote(
  stayType: StayType,
  checkIn: Date,
  checkOut: Date,
  nightlyRate: number,
  hourlyRate: number | null
): { units: number; total: number; unitLabel: string } | { error: string } {
  const ms = checkOut.getTime() - checkIn.getTime();
  if (!(ms > 0)) return { error: "Check-out must be after check-in." };
  if (stayType === "nightly") {
    const units = Math.max(1, Math.ceil(ms / 86_400_000));
    return { units, total: units * nightlyRate, unitLabel: units === 1 ? "night" : "nights" };
  }
  if (hourlyRate == null) return { error: "This room type has no hourly rate." };
  const units = Math.max(1, Math.ceil(ms / 3_600_000));
  return { units, total: units * hourlyRate, unitLabel: units === 1 ? "hour" : "hours" };
}
```
- [ ] **Step 2:** `schemas.ts` — the walk-in / staff booking form:
```ts
import { z } from "zod";
export const bookingSchema = z.object({
  guest_name: z.string().trim().min(1, "Guest name is required").max(120),
  guest_phone: z.string().trim().max(40).optional().or(z.literal("")),
  guest_email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  room_type_id: z.string().uuid("Select a room type"),
  stay_type: z.enum(["nightly", "hourly"]),
  check_in: z.string().min(1, "Check-in is required"),   // datetime-local string
  check_out: z.string().min(1, "Check-out is required"),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
export type BookingFormValues = z.input<typeof bookingSchema>;
export type BookingInput = z.infer<typeof bookingSchema>;

export const BOOKING_STATUSES = ["confirmed","checked_in","checked_out","cancelled","no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: "Confirmed", checked_in: "Checked in", checked_out: "Checked out",
  cancelled: "Cancelled", no_show: "No-show",
};
```
- [ ] **Step 3:** `repository.ts` — `listBookings()` selects bookings joined to `rooms(label)` and `room_types(name)`, ordered by `lower(period)` desc; `getBooking(id)`. Type `BookingRow` includes the joins. Parse `period` (Postgres returns a range string like `["2026-...","2026-...")`) via a `parsePeriod(raw)` helper returning `{ checkIn: string; checkOut: string }`.
- [ ] **Step 4:** `npm run build` — Expected: PASS. Commit.

---

### Task 4: Booking actions + availability + DB test

**Files:**
- Create: `src/features/bookings/actions.ts`
- Create: `supabase/tests/bookings.test.mjs`; add to `test:db`

**Interfaces:**
- Produces: `createBooking(input) → ActionResult<{ id, reference_code }>`; `checkAvailability(roomTypeId, checkIn, checkOut) → ActionResult<{ count }>`; `cancelBooking(id) → ActionResult`.

- [ ] **Step 1:** Write `bookings.test.mjs`: admin creates a nightly booking via `rpc('fn_create_booking', …)` → returns a row with an assigned room + correct `quoted_total` (nights×rate); a second overlapping booking for the **same single-room type** returns `no_availability`; a non-overlapping booking succeeds; `fn_count_available` reflects bookings; cancelling (status→'cancelled') frees the room so a previously-blocked window now books; hourly booking on a type with `hourly_rate` prices by hours, and a type with null hourly_rate raises `hourly_unavailable`.
- [ ] **Step 2:** Run it — Expected: FAIL until assertions match; iterate against the real functions (they exist from Task 2, so this mostly verifies behavior) to PASS.
- [ ] **Step 3:** Write `actions.ts`: `createBooking` → `requireRole(["admin","front_desk"])` → `bookingSchema.parse` → convert `check_in/out` strings to ISO → `supabase.rpc("fn_create_booking", {...})` → on Postgres error map `no_availability`/`invalid_period`/`hourly_unavailable`/`inactive_type` to friendly messages → `logAudit` → `revalidatePath("/bookings")`. `checkAvailability` → `rpc("fn_count_available", …)`. `cancelBooking` → update status to `cancelled` (staff) → audit → revalidate.
- [ ] **Step 4:** `supabase db reset && node supabase/tests/bookings.test.mjs` — Expected: PASS. Add to `test:db`.
- [ ] **Step 5:** `npm run build` — Expected: PASS. Commit.

---

### Task 5: Bookings list + detail

**Files:**
- Create: `src/app/(app)/bookings/page.tsx`
- Create: `src/features/bookings/components/{bookings-table.tsx,booking-status-badge.tsx}`

**Interfaces:**
- Consumes: `listBookings`, `cancelBooking`, `BOOKING_STATUS_LABELS`.

- [ ] **Step 1:** `booking-status-badge.tsx` — maps status → Badge variant/label (confirmed=default, checked_in=blue-ish, checked_out=secondary, cancelled/no_show=destructive/outline).
- [ ] **Step 2:** `bookings-table.tsx` ("use client"): `DataTable` columns — reference_code, guest, room (label + type), stay type, check-in → check-out (formatted `en-PH`), total (peso), status badge, payment badge, and a row menu (View detail link, Cancel via `ConfirmDialog` when status is confirmed/checked_in).
- [ ] **Step 3:** `page.tsx` (RSC): `await requireRole(["admin","front_desk"])`; `listBookings()`; `PageHeader` with a "New walk-in" trigger (Task 6 dialog); render the table. Provide `activeRoomTypes` to the dialog.
- [ ] **Step 4:** `npm run build && npm run lint` — Expected: PASS. Commit.

---

### Task 6: Walk-in quick-book dialog

**Files:**
- Create: `src/features/bookings/components/walk-in-dialog.tsx`
- Modify: `src/app/(app)/bookings/page.tsx` (wire the dialog into the header)

**Interfaces:**
- Consumes: `bookingSchema`, `createBooking`, `checkAvailability`, `quote`, `listActiveRoomTypes`.

- [ ] **Step 1:** `walk-in-dialog.tsx` ("use client"): RHF + `bookingSchema`. Fields: guest name/phone/email (`FormInput`), room type (`FormSelect` from active types), stay type (`FormSelect` nightly/hourly), check-in & check-out (`FormInput type="datetime-local"`), notes (`FormTextarea`). A live **summary panel** watches the form (`useWatch`) and shows `quote(...)` price + a debounced `checkAvailability` count ("3 rooms free" / "No rooms free"). Submit disabled when unavailable or price errors. On success, toast the reference code, close, `router.refresh()`.
- [ ] **Step 2:** Default the datetimes sensibly (nightly: today 14:00 → tomorrow 12:00). Convert `datetime-local` (local, no tz) to ISO before sending.
- [ ] **Step 3:** Wire the dialog into the `/bookings` header (replace the placeholder trigger).
- [ ] **Step 4:** Seed 2–3 demo bookings in `supabase/seed.sql` (via `fn_create_booking` or direct insert with computed room) so the list has content. `supabase db reset`.
- [ ] **Step 5:** `npm run build && npm run lint` — Expected: PASS. Playwright: sign-in as admin (mint-session helper), open `/bookings`, screenshot; open the walk-in dialog, fill it, submit, verify a new row + toast. Commit.

---

## Self-Review

- **Spec coverage:** bookings table + `tstzrange` + GiST exclusion (Task 1) = the double-booking guarantee; `fn_create_booking` auto-assigns a room and prices authoritatively (Task 2); nightly+hourly pricing (Task 2 SQL + Task 3 TS preview); availability query (`fn_count_available`, Task 2/4); walk-in quick-book (Task 6); list/detail (Task 5). Cancel frees the room (exclusion `WHERE status IN (confirmed,checked_in)` — cancelled rows drop out). Portal reuse is pre-staged: `fn_create_booking` is `SECURITY DEFINER` and just needs an `anon` grant in M5.
- **Placeholders:** none — SQL, schemas, and pricing are concrete; component tasks specify exact fields and the shared primitives.
- **Type consistency:** `stay_type`/`booking_status` enums align across migration, schemas (`BOOKING_STATUSES`), and pricing (`StayType`). `fn_create_booking` parameter order fixed in Task 2 and consumed identically in the action (Task 4) and test (Task 4). `quote()` mirrors the SQL unit math exactly (ceil, min 1, 86400/3600 seconds).
