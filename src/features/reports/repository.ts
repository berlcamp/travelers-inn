import { createClient } from "@/lib/supabase/server";
import { parsePeriod, resolveStaffNames } from "@/features/bookings/repository";
import { computeDashboard, type DashboardData, type RptBooking, type RptPayment } from "./reports";
import {
  computeBookingReport,
  computeFinancialReport,
  rangeBounds,
  type BookingReport,
  type FinancialReport,
  type ReportBooking,
  type ReportPayment,
} from "./analytics";

// Fetches the raw data for the dashboard and computes the metrics. Reads run
// under RLS as the signed-in staff member.
export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();
  const since = new Date();
  since.setDate(since.getDate() - 8);

  const [{ data: rooms }, { data: bookings }, { data: payments }] = await Promise.all([
    supabase.from("rooms").select("id"),
    supabase
      .from("bookings")
      .select(
        "id, room_id, status, period, quoted_total, guest_name, room:rooms(label), room_type:room_types(name)"
      )
      // pending_verification bookings already hold a room and owe a balance,
      // so computeDashboard needs them in the pool too (see reports.ts).
      .in("status", ["pending_verification", "confirmed", "checked_in", "checked_out"]),
    supabase
      .from("payments")
      .select("amount, created_at, booking_id")
      .gte("created_at", since.toISOString()),
  ]);

  const rptBookings: RptBooking[] = (bookings ?? []).map((b) => {
    const row = b as typeof b & {
      period: string;
      room: { label: string } | null;
      room_type: { name: string } | null;
    };
    const { checkIn, checkOut } = parsePeriod(row.period);
    return {
      id: row.id,
      roomId: row.room_id,
      status: row.status,
      checkIn,
      checkOut,
      quotedTotal: Number(row.quoted_total),
      guestName: row.guest_name,
      roomLabel: row.room?.label ?? "",
      roomTypeName: row.room_type?.name ?? "",
    };
  });

  const rptPayments: RptPayment[] = (payments ?? []).map((p) => ({
    amount: Number(p.amount),
    createdAt: p.created_at,
    bookingId: p.booking_id,
  }));

  return computeDashboard({
    now: new Date(),
    roomIds: (rooms ?? []).map((r) => r.id),
    bookings: rptBookings,
    payments: rptPayments,
  });
}

// ---- admin reports ----------------------------------------------------------

const REPORT_BOOKING_SELECT =
  "id, reference_code, guest_name, status, source, room_id, period, quoted_total, guest_count, " +
  "created_at, created_by, verified_by, verified_at, room:rooms(label), room_type:room_types(name)";

type RawBooking = {
  id: string;
  reference_code: string;
  guest_name: string;
  status: string;
  source: string;
  room_id: string;
  period: string;
  quoted_total: number;
  guest_count: number;
  created_at: string;
  created_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  room: { label: string } | null;
  room_type: { name: string } | null;
};

// Mirrors the status sets analytics.ts computes with — kept as literal tuples
// so the query builder type-checks them against booking_status.
const OCCUPYING = ["pending_verification", "confirmed", "checked_in", "checked_out"] as const;
const ACTIVE = ["pending_verification", "confirmed", "checked_in"] as const;

export type ReportData = {
  from: string;
  to: string;
  roomsTotal: number;
  financial: FinancialReport;
  bookings: BookingReport;
};

// Three overlapping booking sets feed one report, and each is needed for a
// different reason:
//   1. created in the range  → what staff sold (all statuses, incl. cancelled)
//   2. staying in the range  → occupancy and ADR (a stay booked in June still
//                              occupies a room in August)
//   3. active, any date      → the outstanding balance, which is a position as
//                              of now and can't be scoped to a date range
// They're merged by id, so a booking in two of them is counted once.
export async function getReportData(from: string, to: string): Promise<ReportData> {
  const supabase = await createClient();
  const { start, end } = rangeBounds(from, to);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [{ data: rooms }, { data: created }, { data: staying }, { data: active }] =
    await Promise.all([
      supabase.from("rooms").select("id"),
      supabase
        .from("bookings")
        .select(REPORT_BOOKING_SELECT)
        .gte("created_at", startIso)
        .lt("created_at", endIso),
      supabase
        .from("bookings")
        .select(REPORT_BOOKING_SELECT)
        .overlaps("period", `[${startIso},${endIso})`)
        .in("status", OCCUPYING),
      supabase.from("bookings").select(REPORT_BOOKING_SELECT).in("status", ACTIVE),
    ]);

  const byId = new Map<string, RawBooking>();
  for (const row of [...(created ?? []), ...(staying ?? []), ...(active ?? [])]) {
    byId.set((row as unknown as RawBooking).id, row as unknown as RawBooking);
  }
  const rawBookings = [...byId.values()];

  // Payments: those received in the range drive every financial figure, plus
  // paid-to-date on the active bookings so the outstanding balance is right.
  const [{ data: rangePayments }, { data: activePayments }] = await Promise.all([
    supabase
      .from("payments")
      .select("id, booking_id, amount, method, reference, created_at, recorded_by")
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    (active ?? []).length > 0
      ? supabase
          .from("payments")
          .select("booking_id, amount")
          .in(
            "booking_id",
            (active ?? []).map((b) => (b as unknown as RawBooking).id)
          )
      : Promise.resolve({ data: [] as { booking_id: string; amount: number }[] }),
  ]);

  const names = await resolveStaffNames([
    ...rawBookings.flatMap((b) => [b.created_by, b.verified_by]),
    ...(rangePayments ?? []).map((p) => p.recorded_by),
  ]);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);

  const bookings: ReportBooking[] = rawBookings.map((b) => {
    const { checkIn, checkOut } = parsePeriod(b.period);
    return {
      id: b.id,
      referenceCode: b.reference_code,
      guestName: b.guest_name,
      status: b.status,
      source: b.source,
      roomId: b.room_id,
      roomLabel: b.room?.label ?? "",
      roomTypeName: b.room_type?.name ?? "",
      quotedTotal: Number(b.quoted_total),
      guestCount: b.guest_count,
      createdAt: b.created_at,
      checkIn,
      checkOut,
      createdBy: b.created_by,
      createdByName: nameOf(b.created_by),
      verifiedBy: b.verified_by,
      verifiedByName: nameOf(b.verified_by),
      verifiedAt: b.verified_at,
    };
  });
  const bookingById = new Map(bookings.map((b) => [b.id, b]));

  const payments: ReportPayment[] = (rangePayments ?? []).map((p) => ({
    id: p.id,
    bookingId: p.booking_id,
    // A payment always belongs to a booking, but that booking only appears in
    // the sets above if it was created, stayed, or is active in this range —
    // a payment settling an old checked-out stay has none of those.
    bookingRef: bookingById.get(p.booking_id)?.referenceCode ?? "—",
    guestName: bookingById.get(p.booking_id)?.guestName ?? "—",
    amount: Number(p.amount),
    method: p.method,
    reference: p.reference,
    createdAt: p.created_at,
    recordedBy: p.recorded_by,
    recordedByName: nameOf(p.recorded_by),
  }));

  const paidByBooking = new Map<string, number>();
  for (const p of activePayments ?? []) {
    const row = p as { booking_id: string; amount: number };
    paidByBooking.set(
      row.booking_id,
      (paidByBooking.get(row.booking_id) ?? 0) + Number(row.amount)
    );
  }

  return {
    from,
    to,
    roomsTotal: (rooms ?? []).length,
    financial: computeFinancialReport({ from, to, payments, bookings, paidByBooking }),
    bookings: computeBookingReport({ from, to, bookings, roomsTotal: (rooms ?? []).length }),
  };
}
