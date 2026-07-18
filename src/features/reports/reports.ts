// Pure, unit-testable dashboard metric computation. No I/O — the repository
// fetches the raw arrays and hands them here.

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

export type RptPayment = { amount: number; createdAt: string; bookingId: string };

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

const ACTIVE = ["confirmed", "checked_in"];
const OCCUPYING = ["confirmed", "checked_in", "checked_out"];
const WEEKDAY = new Intl.DateTimeFormat("en-PH", { weekday: "short" });

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
// The nightly window for a given day: 14:00 that day → 12:00 the next.
function nightWindow(day: Date): [Date, Date] {
  const start = startOfDay(day);
  start.setHours(14, 0, 0, 0);
  const end = startOfDay(addDays(day, 1));
  end.setHours(12, 0, 0, 0);
  return [start, end];
}
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function computeDashboard(input: DashboardInput): DashboardData {
  const { now, roomIds, bookings, payments } = input;
  const roomsTotal = roomIds.length;

  const arrivalsToday = bookings.filter(
    (b) => b.status === "confirmed" && sameDay(new Date(b.checkIn), now)
  );
  const departuresToday = bookings.filter(
    (b) => b.status === "checked_in" && sameDay(new Date(b.checkOut), now)
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

  const revenueToday = payments
    .filter((p) => sameDay(new Date(p.createdAt), now))
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
  const days = Array.from({ length: 7 }, (_, i) => addDays(now, i - 6));

  const revenueByDay = days.map((day) =>
    payments
      .filter((p) => sameDay(new Date(p.createdAt), day))
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
