# Travelers Inn — M2 Rooms & Rates Implementation Plan

> **For agentic workers:** Execute task-by-task (superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Admin-managed room types (with nightly + hourly rates) and physical rooms (with housekeeping status), built on the shared CRUD conventions (data-table, form-fields, server actions, repository, RLS).

**Architecture:** New `booking.room_types` and `booking.rooms` tables (public-readable for the future portal, staff-writable). A `features/rooms` module with one Zod schema per entity driving both the RHF form and the server action. First list pages introduce the shared `data-table` and `form-fields` components ported from prime-hrm-2.

**Tech Stack:** As M1, plus TanStack Table, shadcn base-nova `table/dialog/alert-dialog/select/checkbox/switch/textarea/badge/field/form/input-group`.

## Global Constraints

(Inherits all of M1's — see `CLAUDE.md`.) Key: schema `booking`; base-nova uses `render` not `asChild`; mutations via server actions (`requireRole` → Zod → repository → `logAudit` → `revalidatePath` → `ActionResult`); Node 22; local stack on 546xx ports; `render` prop for composition.

---

### Task 1: Shared UI primitives + components

**Files:**
- Add shadcn: `table dialog alert-dialog select checkbox switch textarea badge field form input-group`
- Create: `src/components/shared/{data-table,form-fields,page-header,confirm-dialog,empty-state,stat-card}.tsx`

**Interfaces:**
- Produces: `DataTable`, `FormInput`, `FormTextarea`, `FormCheckbox`, `FormSelect` (+ `SelectOption`), `PageHeader`, `ConfirmDialog`, `EmptyState`, `StatCard`.

- [ ] **Step 1:** `npx shadcn@latest add table dialog alert-dialog select checkbox switch textarea badge field form input-group --yes`.
- [ ] **Step 2:** Port the six shared components verbatim from prime-hrm-2 (`data-table.tsx`, `form-fields.tsx`, `page-header.tsx`, `confirm-dialog.tsx`, `empty-state.tsx`, `stat-card.tsx`) — they are domain-agnostic.
- [ ] **Step 3:** `npm run build` — Expected: PASS (may need to fix any missing ui import names).
- [ ] **Step 4:** Commit.

---

### Task 2: Migration 5 — room_types + rooms + RLS

**Files:**
- Create: `supabase/migrations/20260718000500_rooms.sql`

**Interfaces:**
- Produces: enum `booking.room_status`; tables `booking.room_types`, `booking.rooms`; public-read + staff-write RLS.

- [ ] **Step 1:** Write migration:
```sql
create type booking.room_status as enum ('vacant', 'occupied', 'cleaning', 'out_of_service');

create table booking.room_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  capacity int not null default 2 check (capacity > 0),
  nightly_rate numeric(10,2) not null check (nightly_rate >= 0),
  hourly_rate numeric(10,2) check (hourly_rate >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index room_types_name_key on booking.room_types (lower(name));

create table booking.rooms (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references booking.room_types (id) on delete restrict,
  label text not null,
  status booking.room_status not null default 'vacant',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index rooms_label_key on booking.rooms (lower(label));
create index rooms_room_type_id_idx on booking.rooms (room_type_id);

create trigger set_updated_at before update on booking.room_types
  for each row execute function booking.set_updated_at();
create trigger set_updated_at before update on booking.rooms
  for each row execute function booking.set_updated_at();

alter table booking.room_types enable row level security;
alter table booking.rooms enable row level security;

-- Public read (the M5 portal shows inventory + prices to anonymous visitors).
create policy room_types_public_read on booking.room_types for select using (true);
create policy rooms_public_read on booking.rooms for select using (true);

-- Room types: admin-only writes.
create policy room_types_admin_all on booking.room_types for all
  using (booking.fn_is_admin()) with check (booking.fn_is_admin());

-- Rooms: admins manage everything; active staff (front desk) may update status.
create policy rooms_admin_all on booking.rooms for all
  using (booking.fn_is_admin()) with check (booking.fn_is_admin());
create policy rooms_staff_update on booking.rooms for update to authenticated
  using (booking.fn_is_active_user()) with check (booking.fn_is_active_user());
```
- [ ] **Step 2:** `npm run db:reset` — Expected: PASS.
- [ ] **Step 3:** `npm run db:types` then `npm run build` — Expected: PASS.
- [ ] **Step 4:** Commit.

---

### Task 3: Rooms feature — schemas + repository

**Files:**
- Create: `src/features/rooms/schemas.ts`, `src/features/rooms/repository.ts`

**Interfaces:**
- Produces: `roomTypeSchema`, `RoomTypeInput`, `roomSchema`, `RoomInput`, `ROOM_STATUS_LABELS`; `listRoomTypes()`, `getRoomType(id)`, `listRooms()`, `listRoomsWithType()`.

- [ ] **Step 1:** Write `schemas.ts`:
```ts
import { z } from "zod";

export const roomTypeSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  capacity: z.coerce.number().int().min(1, "At least 1").max(20),
  nightly_rate: z.coerce.number().min(0, "Must be ≥ 0"),
  hourly_rate: z.coerce.number().min(0).optional().nullable(),
  is_active: z.boolean().default(true),
});
export type RoomTypeInput = z.infer<typeof roomTypeSchema>;

export const ROOM_STATUSES = ["vacant", "occupied", "cleaning", "out_of_service"] as const;
export const ROOM_STATUS_LABELS: Record<(typeof ROOM_STATUSES)[number], string> = {
  vacant: "Vacant",
  occupied: "Occupied",
  cleaning: "Cleaning",
  out_of_service: "Out of service",
};

export const roomSchema = z.object({
  id: z.string().uuid().optional(),
  room_type_id: z.string().uuid("Select a room type"),
  label: z.string().trim().min(1, "Label is required").max(40),
  status: z.enum(ROOM_STATUSES).default("vacant"),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
export type RoomInput = z.infer<typeof roomSchema>;
```
- [ ] **Step 2:** Write `repository.ts` using the RLS-scoped server client (`@/lib/supabase/server`): `listRoomTypes()` orders by name; `getRoomType(id)`; `listRoomsWithType()` selects rooms with `room_types(name)` joined, ordered by label. Each returns typed rows or `[]`.
- [ ] **Step 3:** `npm run build` — Expected: PASS.
- [ ] **Step 4:** Commit.

---

### Task 4: Room-type server actions + DB test

**Files:**
- Create: `src/features/rooms/actions.ts`
- Create: `supabase/tests/rooms.test.mjs`; add to `test:db`

**Interfaces:**
- Consumes: `roomTypeSchema`, `roomSchema`.
- Produces: `saveRoomType(input)`, `toggleRoomTypeActive(id, active)`, `saveRoom(input)`, `updateRoomStatus(id, status)` — all `Promise<ActionResult<...>>`.

- [ ] **Step 1:** Write `rooms.test.mjs` (adapts `_helpers.mjs`): admin creates a room type (nightly+hourly) → row exists; duplicate name (case-insensitive) rejected by unique index; front_desk user **cannot** insert a room type (RLS denies) but **can** update a room's status; negative `nightly_rate` rejected by check constraint.
- [ ] **Step 2:** Run it — Expected: FAIL (no actions/data yet; write assertions against direct PostgREST calls so the test targets the DB layer, not the action layer).
- [ ] **Step 3:** Write `actions.ts`: each action `"use server"` → `requireRole(["admin"])` (room types) or `requireRole(["admin","front_desk"])` (room status) → Zod parse → server client upsert/update → `logAudit` → `revalidatePath("/room-types" | "/rooms")` → `ok()`. `updateRoomStatus` guards the enum with `roomSchema.shape.status`.
- [ ] **Step 4:** Run `npm run db:reset && node supabase/tests/rooms.test.mjs` — Expected: PASS. Add the file to the `test:db` script.
- [ ] **Step 5:** `npm run build` — Expected: PASS. Commit.

---

### Task 5: Room Types admin page

**Files:**
- Create: `src/app/(app)/room-types/page.tsx`
- Create: `src/features/rooms/components/{room-types-table.tsx,room-type-form-dialog.tsx}`

**Interfaces:**
- Consumes: `listRoomTypes`, `saveRoomType`, `toggleRoomTypeActive`, form-fields, `DataTable`.

- [ ] **Step 1:** `page.tsx` (RSC): `await requireRole(["admin"])`; `const types = await listRoomTypes()`; render `PageHeader` (title + "Add room type" dialog trigger) and `RoomTypesTable`. Peso amounts formatted with `Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP"})`.
- [ ] **Step 2:** `room-type-form-dialog.tsx` ("use client"): RHF + `zodResolver(roomTypeSchema)`, `FormInput` (name, capacity, nightly_rate, hourly_rate), `FormTextarea` (description), `FormCheckbox` (is_active); submit calls `saveRoomType`, toasts result, closes on success, `router.refresh()`.
- [ ] **Step 3:** `room-types-table.tsx` ("use client"): `DataTable` with columns name, capacity, nightly rate, hourly rate, active badge, and a row actions menu (Edit → dialog; Activate/Deactivate → `toggleRoomTypeActive`).
- [ ] **Step 4:** `npm run build && npm run lint` — Expected: PASS. Commit.

---

### Task 6: Rooms page (list + status)

**Files:**
- Create: `src/app/(app)/rooms/page.tsx`
- Create: `src/features/rooms/components/{rooms-table.tsx,room-form-dialog.tsx,room-status-select.tsx}`

**Interfaces:**
- Consumes: `listRoomsWithType`, `listRoomTypes`, `saveRoom`, `updateRoomStatus`.

- [ ] **Step 1:** `page.tsx` (RSC): `await requireUser()` (any staff); load rooms + types; `PageHeader` with an "Add room" dialog (admin only — pass `isAdmin`). Show `EmptyState` when there are no room types yet (link to /room-types).
- [ ] **Step 2:** `room-form-dialog.tsx`: RHF + `roomSchema`; `FormInput` (label), `FormSelect` (room_type_id from types, status), `FormTextarea` (notes); calls `saveRoom`.
- [ ] **Step 3:** `room-status-select.tsx` ("use client"): inline `Select` bound to `updateRoomStatus(id, status)` with an optimistic toast — usable by front desk.
- [ ] **Step 4:** `rooms-table.tsx`: columns label, type name, status (the status select), notes; admin gets an Edit action.
- [ ] **Step 5:** `npm run build && npm run lint` — Expected: PASS.
- [ ] **Step 6:** Seed a couple of demo room types + rooms in `supabase/seed.sql` (idempotent inserts) so the pages have content. `npm run db:reset`.
- [ ] **Step 7:** Playwright smoke: sign-in bootstrap not required — verify `/room-types` and `/rooms` render (redirect to /login when signed out is enough for the gate; full CRUD verified by the DB test). Commit.

---

## Self-Review

- **Spec coverage:** room types w/ nightly+hourly rates (Task 2/3/5), physical rooms w/ status (Task 2/3/6), admin-only rate management (RLS Task 2 + `requireRole` Task 4), housekeeping status update by front desk (RLS `rooms_staff_update` + `updateRoomStatus`). Public-read policy pre-stages the M5 portal.
- **Placeholders:** none — migration and schemas are concrete; component tasks specify exact files, props, and the shared primitives they compose.
- **Type consistency:** `roomTypeSchema`/`roomSchema` names and the `ROOM_STATUSES` tuple are reused across repository, actions, forms, and tests. `saveRoomType`/`saveRoom`/`updateRoomStatus`/`toggleRoomTypeActive` signatures fixed in Task 4 and consumed unchanged in Tasks 5–6.
