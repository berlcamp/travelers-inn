# Travelers Inn — M6 Reports & Dashboard Implementation Plan

> **For agentic workers:** Execute task-by-task (superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the placeholder dashboard into a real front-desk command view — today's arrivals/departures, in-house count, tonight's occupancy, revenue today, outstanding balance, and 7-day revenue & occupancy trends.

**Architecture:** Metrics are computed by pure, unit-testable functions (`features/reports/reports.ts`) from three fetched arrays (rooms, non-cancelled bookings, recent payments). The repository fetches the raw data with the RLS-scoped server client and calls the pure functions. The dashboard reuses `StatCard` and the existing `BookingManageDialog` so staff can check arrivals in directly.

**Tech Stack:** As M5. No new dependencies (trends render as CSS bars).

## Global Constraints

(Inherits all prior — see `CLAUDE.md`.) Key: schema `booking`; base-nova `render` not `asChild` (+ `nativeButton={false}` for Button-as-Link); Node 22; local stack 546xx; occupancy uses the nightly window `[day 14:00, next-day 12:00)`; money is PHP via `peso`.

---

### Task 1: Reports pure functions + repository + unit test

**Files:**
- Create: `src/features/reports/reports.ts`, `src/features/reports/repository.ts`
- Create: `supabase/tests/reports.test.mjs` (pure-function unit test, no DB)

**Interfaces:**
- Produces: `computeDashboard(input) → DashboardData`; `getDashboardData() → DashboardData` (server).

- [ ] **Step 1:** `reports.ts` — pure. Types:
```ts
export type RptBooking = { id: string; roomId: string; status: string; checkIn: string; checkOut: string; quotedTotal: number; guestName: string; roomLabel: string; roomTypeName: string };
export type RptPayment = { amount: number; createdAt: string; bookingId: string };
export type DashboardInput = { now: Date; roomIds: string[]; bookings: RptBooking[]; payments: RptPayment[] };
export type TrendPoint = { label: string; value: number; max: number };
export type DashboardData = {
  arrivalsToday: RptBooking[];
  departuresToday: RptBooking[];
  inHouse: number;
  roomsTotal: number;
  roomsOccupiedTonight: number;
  occupancyPct: number;
  revenueToday: number;
  outstanding: number;
  revenue7d: TrendPoint[];
  occupancy7d: TrendPoint[];
};
```
Implement:
- Day helpers `startOfDay(d)`, `sameDay(a,b)`, nightly window `nightWindow(day) = [day@14:00, nextday@12:00)`, `overlaps(aStart,aEnd,bStart,bEnd)`.
- Active statuses `["confirmed","checked_in"]`.
- `arrivalsToday`: active bookings whose check-in is today (`sameDay(checkIn, now)`), status `confirmed`.
- `departuresToday`: `checked_in` bookings whose check-out is today.
- `inHouse`: count status `checked_in`.
- `roomsOccupiedTonight`: distinct rooms whose active booking overlaps `nightWindow(now)`.
- `occupancyPct`: `roomsTotal ? round(100*occupied/roomsTotal) : 0`.
- `revenueToday`: sum payments with `sameDay(createdAt, now)`.
- `outstanding`: over active bookings, `sum(max(0, quotedTotal - paidPerBooking))` where paid is summed from payments.
- `revenue7d`: last 7 days incl today; each day's summed payments; `max` = max across the 7 for bar scaling; label = weekday short.
- `occupancy7d`: last 7 days; each day count rooms whose booking (status in confirmed/checked_in/checked_out) overlaps that night; `max = roomsTotal`.
- [ ] **Step 2:** `reports.test.mjs` — import via `node --experimental-strip-types`? Instead keep the test **pure JS**: re-declare a tiny fixture and assert `computeDashboard` by importing the compiled logic is awkward from .ts. So write the unit test as a **standalone .mjs that reimplements nothing** — import is the problem. Resolution: put the pure helpers' behaviour under test by testing `computeDashboard` through a `.mjs` that imports it with a data-URL loader is overkill. **Simpler:** write `reports.test.mjs` that constructs a `DashboardInput`-shaped object and calls `computeDashboard` imported from a **sibling `.mjs` mirror is duplication** — avoid. FINAL DECISION: author `reports.ts` and ALSO run its logic through a Node test using `node --experimental-strip-types supabase/tests/reports.test.ts` importing `../../src/features/reports/reports.ts` via a **relative path** (no `@/` alias in this file). Assert: 2 arrivals today, 1 departure, occupancy math, revenueToday, outstanding, and 7-length trend arrays. Add to `test:db` as `node --experimental-strip-types supabase/tests/reports.test.ts`.
- [ ] **Step 3:** `repository.ts` — `getDashboardData()`: server client; fetch `rooms(id)`, `bookings` (status in confirmed/checked_in/checked_out, select id, room_id, status, period, quoted_total, guest_name + joins room(label), room_type(name)) parsing periods via `parsePeriod`, and `payments` (created_at >= now-8d; amount, created_at, booking_id). Map to `Rpt*` and call `computeDashboard({ now: new Date(), … })`.
- [ ] **Step 4:** `node --experimental-strip-types supabase/tests/reports.test.ts` — PASS. `npm run build` — PASS. Commit.

---

### Task 2: Dashboard page

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`
- Create: `src/features/reports/components/{trend-bars.tsx,arrivals-list.tsx}`

**Interfaces:**
- Consumes: `getDashboardData`, `StatCard`, `BookingManageDialog`, `peso`.

- [ ] **Step 1:** `trend-bars.tsx`: renders a `TrendPoint[]` as a row of CSS bars (height ∝ value/max), weekday labels, and a value tooltip/label; a `format` prop (peso vs count).
- [ ] **Step 2:** `arrivals-list.tsx` ("use client"): a compact list of bookings (guest, room, time) each with a `BookingManageDialog` "Manage" trigger, so the desk can check arrivals in from the dashboard. Empty-state text when none.
- [ ] **Step 3:** `dashboard/page.tsx` (RSC): `requireRole(["admin","front_desk"])`; `getDashboardData()`. Render: greeting; a stat grid (Arrivals today, Departures today, In-house, Occupancy tonight `%`, Revenue today `peso`, Outstanding `peso`) via `StatCard`; two `ArrivalsList`s (arrivals / departures); a card with the 7-day revenue `TrendBars` and one with 7-day occupancy `TrendBars`.
- [ ] **Step 4:** `npm run build && npm run lint` — PASS. Commit.

---

### Task 3: Seed enrichment + verify

**Files:**
- Modify: `supabase/seed.sql`

- [ ] **Step 1:** Enrich the seed so the dashboard shows life: ensure one booking arrives today (already), one is `checked_in` (already — Jose), and add a **checked-out** past booking with a full payment dated a couple of days ago (so revenue/occupancy trends and revenue history are non-trivial). Keep guards idempotent.
- [ ] **Step 2:** `supabase db reset` — PASS. `npm run test:db` — all suites PASS (incl. reports).
- [ ] **Step 3:** `supabase db reset` again to re-seed (tests wipe data). Playwright: mint an admin session, open `/dashboard`, confirm the stat cards show real figures matching the seed (arrivals/departures/in-house/occupancy/revenue), the arrivals list renders with a working Manage dialog, and both 7-day trend bars render. Screenshot.
- [ ] **Step 4:** `npm run build && npm run lint`. Commit.

---

## Self-Review

- **Spec coverage:** occupancy % (tonight + 7-day trend), revenue (today + 7-day trend), arrivals/departures today, plus in-house and outstanding — the design's dashboard metrics. Reuses the manage dialog so the dashboard is actionable.
- **Placeholders:** none — the metric definitions and fetch shapes are concrete. (Task 1 Step 2's testing note resolves to: relative-import `.ts` test run under `node --experimental-strip-types`, matching prime-hrm's `test:unit` precedent.)
- **Type consistency:** `computeDashboard` input/output types are shared by repository and page; active-status set (`confirmed`/`checked_in`) matches the exclusion-constraint and M4 lifecycle; occupancy window matches the nightly `[14:00,12:00)` convention used when constructing bookings.
