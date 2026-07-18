import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

type BookingBase = Database["booking"]["Tables"]["bookings"]["Row"];

export type BookingRow = BookingBase & {
  room: { label: string } | null;
  room_type: { name: string } | null;
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

const SELECT = "*, room:rooms(label), room_type:room_types(name)";

export async function listBookings(): Promise<BookingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select(SELECT)
    .order("period", { ascending: false });
  return (data ?? []).map((b) => {
    const { checkIn, checkOut } = parsePeriod((b as { period: string }).period);
    return { ...(b as BookingBase & { room: { label: string } | null; room_type: { name: string } | null }), checkIn, checkOut };
  });
}

export async function getBooking(id: string): Promise<BookingRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("bookings").select(SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const { checkIn, checkOut } = parsePeriod((data as { period: string }).period);
  return {
    ...(data as BookingBase & { room: { label: string } | null; room_type: { name: string } | null }),
    checkIn,
    checkOut,
  };
}
