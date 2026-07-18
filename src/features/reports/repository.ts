import { createClient } from "@/lib/supabase/server";
import { parsePeriod } from "@/features/bookings/repository";
import { computeDashboard, type DashboardData, type RptBooking, type RptPayment } from "./reports";

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
      .in("status", ["confirmed", "checked_in", "checked_out"]),
    supabase.from("payments").select("amount, created_at, booking_id").gte("created_at", since.toISOString()),
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
