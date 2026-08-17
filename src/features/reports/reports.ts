// Pure, unit-testable dashboard metric computation. No I/O — the repository
// fetches the raw arrays and hands them here.
//
// Every day boundary below is a day at the INN, never a day wherever this
// happens to run: on the UTC server `setHours(0)` made "today's revenue" run
// 8 AM → 8 AM. Relative + .ts extension so this still runs under
// `node --experimental-strip-types` (supabase/tests/reports.test.ts) — the
// only import allowed here is another pure module.
import { innAddDays, innAtHour, innFormatter, innSameDay } from "../../lib/inn-time.ts";

export type RptBooking = {
  id: string;
  roomId: string;
  status: string;
  checkIn: string;
  checkOut: string;
  quotedTotal: number;
  guestName: string;
  roomLabel: string;
  roomTypeName: string;
};

export type RptPayment = {
  amount: number;
  createdAt: string;
  bookingId: string;
  /** Status of the booking it settles. A cancelled booking's money went back
   *  to the guest, so it is not revenue — see countsAsRevenue below. */
  bookingStatus: string;
};

export type DashboardInput = {
  now: Date;
  roomIds: string[];
  bookings: RptBooking[];
  payments: RptPayment[];
};

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

// A pending_verification booking already holds its room (guest paid the
// deposit, room is reserved for them) and still owes a balance, so it counts
// toward tonight's/each night's occupancy and the outstanding total. It does
// NOT count as a finalised "confirmed" arrival — arrivalsToday below stays
// scoped to "confirmed" only.
const ACTIVE = ["pending_verification", "confirmed", "checked_in"];
const OCCUPYING = ["pending_verification", "confirmed", "checked_in", "checked_out"];
// Cancelling hands the money back, so a payment on a cancelled booking is not
// revenue. A no-show is NOT here: that money was forfeited, not returned.
// Duplicated from analytics.ts `countsAsRevenue` on purpose — keeping the two
// modules independent of each other; keep them in step.
const REFUNDED = ["cancelled"];
function countsAsRevenue(p: RptPayment): boolean {
  return !REFUNDED.includes(p.bookingStatus);
}
const WEEKDAY = innFormatter({ weekday: "short" });

// The nightly window for a given day: 14:00 that day → 12:00 the next, both on
// the inn's clock.
function nightWindow(day: Date): [Date, Date] {
  return [innAtHour(day, 14), innAtHour(innAddDays(day, 1), 12)];
}
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function computeDashboard(input: DashboardInput): DashboardData {
  const { now, roomIds, bookings, payments } = input;
  const roomsTotal = roomIds.length;

  const arrivalsToday = bookings.filter(
    (b) => b.status === "confirmed" && innSameDay(new Date(b.checkIn), now)
  );
  const departuresToday = bookings.filter(
    (b) => b.status === "checked_in" && innSameDay(new Date(b.checkOut), now)
  );
  const inHouse = bookings.filter((b) => b.status === "checked_in").length;

  const [tonightStart, tonightEnd] = nightWindow(now);
  const occupiedRooms = new Set(
    bookings
      .filter(
        (b) =>
          ACTIVE.includes(b.status) &&
          overlaps(new Date(b.checkIn), new Date(b.checkOut), tonightStart, tonightEnd)
      )
      .map((b) => b.roomId)
  );
  const roomsOccupiedTonight = occupiedRooms.size;
  const occupancyPct = roomsTotal ? Math.round((100 * roomsOccupiedTonight) / roomsTotal) : 0;

  const earned = payments.filter(countsAsRevenue);

  const revenueToday = earned
    .filter((p) => innSameDay(new Date(p.createdAt), now))
    .reduce((acc, p) => acc + p.amount, 0);

  // Outstanding: unpaid balance across still-active bookings.
  const paidByBooking = new Map<string, number>();
  for (const p of payments) {
    paidByBooking.set(p.bookingId, (paidByBooking.get(p.bookingId) ?? 0) + p.amount);
  }
  const outstanding = bookings
    .filter((b) => ACTIVE.includes(b.status))
    .reduce((acc, b) => acc + Math.max(0, b.quotedTotal - (paidByBooking.get(b.id) ?? 0)), 0);

  // 7-day series (oldest → today).
  const days = Array.from({ length: 7 }, (_, i) => innAddDays(now, i - 6));

  const revenueByDay = days.map((day) =>
    earned
      .filter((p) => innSameDay(new Date(p.createdAt), day))
      .reduce((acc, p) => acc + p.amount, 0)
  );
  const revenueMax = Math.max(1, ...revenueByDay);
  const revenue7d: TrendPoint[] = days.map((day, i) => ({
    label: WEEKDAY.format(day),
    value: revenueByDay[i],
    max: revenueMax,
  }));

  const occupancy7d: TrendPoint[] = days.map((day) => {
    const [s, e] = nightWindow(day);
    const rooms = new Set(
      bookings
        .filter(
          (b) =>
            OCCUPYING.includes(b.status) &&
            overlaps(new Date(b.checkIn), new Date(b.checkOut), s, e)
        )
        .map((b) => b.roomId)
    );
    return { label: WEEKDAY.format(day), value: rooms.size, max: Math.max(1, roomsTotal) };
  });

  return {
    arrivalsToday,
    departuresToday,
    inHouse,
    roomsTotal,
    roomsOccupiedTonight,
    occupancyPct,
    revenueToday,
    outstanding,
    revenue7d,
    occupancy7d,
  };
}
