// Pure, unit-testable report computation for the admin reports module. No I/O
// — the repository fetches the rows for a date range and hands them here.
//
// Two different clocks are in play and mixing them up would silently produce
// wrong money:
//   * FINANCIAL figures follow the CASH: a payment counts in the range it was
//     RECEIVED in, regardless of when the stay happens. That's what reconciling
//     a cash drawer or a GCash statement needs.
//   * BOOKING figures follow the STAY for occupancy/ADR (nights actually slept
//     inside the range) and the BOOKING DATE for "bookings taken" (which staff
//     member sold what, when).
// Each computed field below says which of the two it uses.

export type ReportBooking = {
  id: string;
  referenceCode: string;
  guestName: string;
  status: string;
  source: string;
  roomId: string;
  roomLabel: string;
  roomTypeId: string;
  roomTypeName: string;
  quotedTotal: number;
  guestCount: number;
  createdAt: string;
  checkIn: string;
  checkOut: string;
  createdBy: string | null;
  createdByName: string | null;
  verifiedBy: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
};

export type ReportPayment = {
  id: string;
  bookingId: string;
  bookingRef: string;
  guestName: string;
  amount: number;
  method: string;
  reference: string | null;
  createdAt: string;
  recordedBy: string | null;
  recordedByName: string | null;
};

export type Bucket = { key: string; label: string; count: number; amount: number };
export type DayPoint = { date: string; label: string; value: number; max: number };

// Narrows the whole report. Both are optional and compose.
export type ReportFilters = {
  /** A room_types.id, or null for every type. */
  roomTypeId: string | null;
  /** A staff member's user id, or null for everyone. */
  staffId: string | null;
};

export const NO_FILTERS: ReportFilters = { roomTypeId: null, staffId: null };

// The two filters are not the same kind of thing, and treating them alike
// would produce numbers nobody could defend:
//
//   * ROOM TYPE is a property of the stay itself, so it narrows every figure
//     uniformly — money, bookings, and room-nights. The occupancy denominator
//     narrows with it (the repository counts only rooms of that type),
//     otherwise a filtered numerator over the whole inn's capacity would read
//     as a collapse in occupancy.
//   * STAFF is an ATTRIBUTION, and the three things a receptionist can be
//     attributed with sit on three different columns: `created_by` (took the
//     booking), `recorded_by` (received the money) and `verified_by` (checked
//     a deposit). Each is filtered on its own column. There is deliberately no
//     single "this staff member's bookings" set: deposits exist only on PORTAL
//     bookings, which have no creator at all, so filtering verifications by
//     `created_by` would always come back empty.
//
// Under a staff filter, occupancy therefore reads as "share of capacity this
// person sold" rather than inn occupancy — the page labels it as such.
function matchesRoomType(b: ReportBooking, f: ReportFilters): boolean {
  return !f.roomTypeId || b.roomTypeId === f.roomTypeId;
}

// Bookings this filter attributes to the selected staff member (or all of
// them). Drives everything on the booking clock except verifications.
function scopeBookings(bookings: ReportBooking[], f: ReportFilters): ReportBooking[] {
  return bookings.filter(
    (b) => matchesRoomType(b, f) && (!f.staffId || b.createdBy === f.staffId)
  );
}

// Stays in these statuses hold a room, so they count toward occupancy.
// Cancelled and no-show stays never occupied anything.
const OCCUPYING = ["pending_verification", "confirmed", "checked_in", "checked_out"];
// Bookings that still owe money and are still live.
const ACTIVE = ["pending_verification", "confirmed", "checked_in"];
// Bookings whose value never materialised — excluded from booked revenue.
const VOID = ["cancelled", "no_show"];

const DAY_MS = 86_400_000;
const DAY_LABEL = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" });

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Inclusive `from`, inclusive `to` — the UI's date inputs are inclusive, so
// "1 Aug to 31 Aug" must contain the whole of the 31st. The exclusive end used
// for overlap maths is midnight after `to`.
export function rangeBounds(from: string, to: string): { start: Date; end: Date; days: number } {
  const start = startOfDay(new Date(`${from}T00:00:00`));
  const end = startOfDay(new Date(`${to}T00:00:00`));
  end.setDate(end.getDate() + 1);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
  return { start, end, days };
}

function within(iso: string, start: Date, end: Date): boolean {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= start.getTime() && t < end.getTime();
}

// The night belonging to date D: 14:00 that day → 12:00 the next. Same
// convention the dashboard uses (features/reports/reports.ts), so occupancy on
// the dashboard and occupancy in a report can never tell different stories.
function nightWindow(day: Date): [number, number] {
  const open = new Date(day);
  open.setHours(14, 0, 0, 0);
  const close = new Date(day);
  close.setDate(close.getDate() + 1);
  close.setHours(12, 0, 0, 0);
  return [open.getTime(), close.getTime()];
}

// Room-nights a stay sells inside [start, end): the number of NIGHTS it
// overlaps, not calendar dates it touches. A standard 14:00 → next-noon stay is
// one night even though it spans two dates — counting dates would inflate
// occupancy and halve the average rate.
//
// A stay that checks in and out on the same date (a block tier — say 10:00 to
// 22:00) is one room-night on that date: it overlaps two night windows, since
// the previous night's runs to noon, but the room was only sold once.
export function nightsBetween(checkIn: string, checkOut: string, start: Date, end: Date): number {
  const inAt = new Date(checkIn).getTime();
  const outAt = new Date(checkOut).getTime();
  if (!Number.isFinite(inAt) || !Number.isFinite(outAt) || outAt <= inAt) return 0;

  const inDay = startOfDay(new Date(inAt));
  const outDay = startOfDay(new Date(outAt));

  if (inDay.getTime() === outDay.getTime()) {
    return inDay >= start && inDay < end ? 1 : 0;
  }

  let count = 0;
  const day = new Date(Math.max(inDay.getTime(), start.getTime()));
  const lastDay = Math.min(outDay.getTime(), end.getTime() - 1);
  for (; day.getTime() <= lastDay; day.setDate(day.getDate() + 1)) {
    const [open, close] = nightWindow(day);
    if (inAt < close && open < outAt) count += 1;
  }
  return count;
}

// Nights in the whole stay, ignoring any report range — the denominator when
// prorating a stay's value across a range boundary. Bounds are widened to
// midnight so the check-in day itself isn't excluded by the range filter.
export function stayNights(checkIn: string, checkOut: string): number {
  const inAt = new Date(checkIn);
  const outAt = new Date(checkOut);
  if (Number.isNaN(inAt.getTime()) || Number.isNaN(outAt.getTime())) return 1;
  const end = startOfDay(outAt);
  end.setDate(end.getDate() + 1);
  return Math.max(1, nightsBetween(checkIn, checkOut, startOfDay(inAt), end));
}

function bucketize(
  rows: { key: string | null; label: string; amount: number }[],
  fallback: { key: string; label: string }
): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const row of rows) {
    const key = row.key ?? fallback.key;
    const label = row.key ? row.label : fallback.label;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.amount += row.amount;
    } else {
      map.set(key, { key, label, count: 1, amount: row.amount });
    }
  }
  // Biggest first — a report is read top-down.
  return [...map.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
}

// ---- financial --------------------------------------------------------------

export type FinancialInput = {
  from: string;
  to: string;
  payments: ReportPayment[];
  bookings: ReportBooking[];
  /** Paid-to-date per booking id, across ALL time — outstanding is a balance
   *  as of now, not something a date range can scope. */
  paidByBooking: Map<string, number>;
  filters?: ReportFilters;
};

export type FinancialReport = {
  collected: number;
  paymentCount: number;
  averagePayment: number;
  byMethod: Bucket[];
  byStaff: Bucket[];
  daily: DayPoint[];
  bookedRevenue: number;
  voidedValue: number;
  outstanding: number;
  payments: ReportPayment[];
};

export function computeFinancialReport(input: FinancialInput): FinancialReport {
  const { start, end, days } = rangeBounds(input.from, input.to);
  const filters = input.filters ?? NO_FILTERS;

  // A payment names a booking, not a room type, so the type filter has to go
  // through the booking. The repository guarantees every payment in the range
  // has its booking in this array — including one settling a stay that neither
  // started, slept, nor is still active in the range — so a type filter can
  // never silently drop money it simply failed to classify.
  const typeOfBooking = new Map(input.bookings.map((b) => [b.id, b.roomTypeId]));
  const paymentMatches = (p: ReportPayment) =>
    (!filters.staffId || p.recordedBy === filters.staffId) &&
    (!filters.roomTypeId || typeOfBooking.get(p.bookingId) === filters.roomTypeId);

  // Cash clock: payments received inside the range.
  const received = input.payments
    .filter((p) => within(p.createdAt, start, end) && paymentMatches(p))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const collected = received.reduce((acc, p) => acc + p.amount, 0);

  const byMethod = bucketize(
    received.map((p) => ({ key: p.method, label: p.method, amount: p.amount })),
    { key: "unknown", label: "Unknown" }
  );
  const byStaff = bucketize(
    received.map((p) => ({
      key: p.recordedBy,
      label: p.recordedByName ?? "Unnamed staff",
      amount: p.amount,
    })),
    // A payment with no recorder is a portal deposit recorded before this
    // column existed, or by a since-deleted account. Never silently dropped.
    { key: "unattributed", label: "Unattributed" }
  );

  const dayTotals = Array.from({ length: days }, (_, i) => {
    const day = new Date(start.getTime() + i * DAY_MS);
    const next = new Date(start.getTime() + (i + 1) * DAY_MS);
    return {
      date: isoDate(day),
      label: DAY_LABEL.format(day),
      value: received
        .filter((p) => within(p.createdAt, day, next))
        .reduce((acc, p) => acc + p.amount, 0),
    };
  });
  const dailyMax = Math.max(1, ...dayTotals.map((d) => d.value));
  const daily: DayPoint[] = dayTotals.map((d) => ({ ...d, max: dailyMax }));

  // Booking clock: what was sold in the range, whether or not it's been paid.
  const scoped = scopeBookings(input.bookings, filters);
  const taken = scoped.filter((b) => within(b.createdAt, start, end));
  const bookedRevenue = taken
    .filter((b) => !VOID.includes(b.status))
    .reduce((acc, b) => acc + b.quotedTotal, 0);
  const voidedValue = taken
    .filter((b) => VOID.includes(b.status))
    .reduce((acc, b) => acc + b.quotedTotal, 0);

  const outstanding = scoped
    .filter((b) => ACTIVE.includes(b.status))
    .reduce((acc, b) => acc + Math.max(0, b.quotedTotal - (input.paidByBooking.get(b.id) ?? 0)), 0);

  return {
    collected,
    paymentCount: received.length,
    averagePayment: received.length ? collected / received.length : 0,
    byMethod,
    byStaff,
    daily,
    bookedRevenue,
    voidedValue,
    outstanding,
    payments: received,
  };
}

// ---- bookings ---------------------------------------------------------------

export type BookingReportInput = {
  from: string;
  to: string;
  bookings: ReportBooking[];
  /** Rooms the occupancy denominator counts — already narrowed to the filtered
   *  room type by the repository. */
  roomsTotal: number;
  filters?: ReportFilters;
};

export type BookingReport = {
  taken: ReportBooking[];
  totalTaken: number;
  guests: number;
  byStatus: Bucket[];
  bySource: Bucket[];
  byRoomType: Bucket[];
  byStaff: Bucket[];
  verifiedByStaff: Bucket[];
  roomNights: number;
  availableRoomNights: number;
  occupancyPct: number;
  stayRevenue: number;
  adr: number;
};

export function computeBookingReport(input: BookingReportInput): BookingReport {
  const { start, end, days } = rangeBounds(input.from, input.to);
  const filters = input.filters ?? NO_FILTERS;
  const scoped = scopeBookings(input.bookings, filters);

  // Booking clock — who sold what in this range.
  const taken = scoped
    .filter((b) => within(b.createdAt, start, end))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const live = taken.filter((b) => !VOID.includes(b.status));

  const byStatus = bucketize(
    taken.map((b) => ({ key: b.status, label: b.status, amount: b.quotedTotal })),
    { key: "unknown", label: "Unknown" }
  );
  const bySource = bucketize(
    taken.map((b) => ({ key: b.source, label: b.source, amount: b.quotedTotal })),
    { key: "unknown", label: "Unknown" }
  );
  const byRoomType = bucketize(
    live.map((b) => ({
      key: b.roomTypeName || "unknown",
      label: b.roomTypeName || "Unknown",
      amount: b.quotedTotal,
    })),
    { key: "unknown", label: "Unknown" }
  );
  const byStaff = bucketize(
    live.map((b) => ({
      key: b.createdBy,
      label: b.createdByName ?? "Unnamed staff",
      amount: b.quotedTotal,
    })),
    // Portal bookings are created by the guest with no staff actor — labelled
    // as the channel rather than hidden, so the counts still add up.
    { key: "portal", label: "Online portal (no staff)" }
  );
  // Deposit verifications done in the range — separate from bookings taken,
  // because the staff member who verifies a portal deposit is usually not the
  // one who "sold" it (nobody did; the guest booked themselves).
  // Filtered on `verified_by` rather than reusing `scoped` — see the note by
  // ReportFilters: a portal booking has no creator, so scoping this by
  // created_by would empty the panel the moment a staff filter was applied.
  const verifiedByStaff = bucketize(
    input.bookings
      .filter((b) => matchesRoomType(b, filters))
      .filter((b) => !filters.staffId || b.verifiedBy === filters.staffId)
      .filter((b) => b.verifiedBy && b.verifiedAt && within(b.verifiedAt, start, end))
      .map((b) => ({
        key: b.verifiedBy,
        label: b.verifiedByName ?? "Unnamed staff",
        amount: b.quotedTotal,
      })),
    { key: "unattributed", label: "Unattributed" }
  );

  // Stay clock — nights actually slept inside the range.
  let roomNights = 0;
  let stayRevenue = 0;
  for (const b of scoped) {
    if (!OCCUPYING.includes(b.status)) continue;
    const nightsInRange = nightsBetween(b.checkIn, b.checkOut, start, end);
    if (nightsInRange === 0) continue;
    roomNights += nightsInRange;
    // Prorate the quoted total across the stay so a booking straddling the
    // range boundary contributes only the part that falls inside it.
    const totalNights = stayNights(b.checkIn, b.checkOut);
    stayRevenue += (b.quotedTotal * Math.min(nightsInRange, totalNights)) / totalNights;
  }

  const availableRoomNights = input.roomsTotal * days;
  return {
    taken,
    totalTaken: taken.length,
    guests: live.reduce((acc, b) => acc + b.guestCount, 0),
    byStatus,
    bySource,
    byRoomType,
    byStaff,
    verifiedByStaff,
    roomNights,
    availableRoomNights,
    occupancyPct: availableRoomNights ? Math.round((100 * roomNights) / availableRoomNights) : 0,
    stayRevenue,
    adr: roomNights ? stayRevenue / roomNights : 0,
  };
}
