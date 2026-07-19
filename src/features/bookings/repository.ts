import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

type BookingBase = Database["booking"]["Tables"]["bookings"]["Row"];

export type BookingRow = BookingBase & {
  room: { label: string } | null;
  room_type: { name: string } | null;
  rate_tier: { label: string } | null;
  checkIn: string;
  checkOut: string;
};

// Postgres serializes tstzrange as `["<lower>","<upper>")` (bounds may be [ or (,
// ] or ) ). Pull out the two timestamps.
export function parsePeriod(raw: string | null): { checkIn: string; checkOut: string } {
  if (!raw) return { checkIn: "", checkOut: "" };
  const m = raw.match(/[[(]\s*"?([^",]*)"?\s*,\s*"?([^",]*)"?\s*[\])]/);
  return { checkIn: m?.[1] ?? "", checkOut: m?.[2] ?? "" };
}

const SELECT = "*, room:rooms(label), room_type:room_types(name), rate_tier:rate_tiers(label)";

export async function listBookings(): Promise<BookingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select(SELECT)
    .order("period", { ascending: false });
  return (data ?? []).map((b) => {
    const { checkIn, checkOut } = parsePeriod((b as { period: string }).period);
    return { ...(b as BookingBase & { room: { label: string } | null; room_type: { name: string } | null; rate_tier: { label: string } | null }), checkIn, checkOut };
  });
}

export async function getBooking(id: string): Promise<BookingRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("bookings").select(SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const { checkIn, checkOut } = parsePeriod((data as { period: string }).period);
  return {
    ...(data as BookingBase & { room: { label: string } | null; room_type: { name: string } | null; rate_tier: { label: string } | null }),
    checkIn,
    checkOut,
  };
}

export type Payment = Database["booking"]["Tables"]["payments"]["Row"];

export function sumPaid(payments: Payment[]): number {
  return payments.reduce((acc, p) => acc + Number(p.amount), 0);
}

export async function listPayments(bookingId: string): Promise<Payment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export type BookingDetail = {
  booking: BookingRow;
  payments: Payment[];
  paid: number;
  availableRooms: { id: string; label: string }[];
};

// Rooms of the booking's type that are free in its window, ignoring the booking
// itself (so its currently-assigned room appears as an option too).
export async function listAvailableRooms(
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
  excludeBooking: string | null
): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("fn_available_rooms", {
    p_room_type_id: roomTypeId,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_exclude_booking: excludeBooking ?? undefined,
  });
  return ((data as { id: string; label: string }[] | null) ?? []).map((r) => ({
    id: r.id,
    label: r.label,
  }));
}

export async function getBookingWithPayments(id: string): Promise<BookingDetail | null> {
  const booking = await getBooking(id);
  if (!booking) return null;
  const payments = await listPayments(id);
  const availableRooms =
    booking.status === "confirmed" || booking.status === "checked_in"
      ? await listAvailableRooms(booking.room_type_id, booking.checkIn, booking.checkOut, booking.id)
      : [];
  return { booking, payments, paid: sumPaid(payments), availableRooms };
}
