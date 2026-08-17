import { createClient } from "@/lib/supabase/server";
import { parsePeriod } from "@/features/bookings/repository";
import { deriveOccupancy, type OccupancyBooking, type RoomOccupancy } from "./occupancy";
import type { Database } from "@/types/database.types";
import { innAddDays, innStartOfDay } from "@/lib/inn-time";

export type RoomType = Database["booking"]["Tables"]["room_types"]["Row"];
export type RateTier = Database["booking"]["Tables"]["rate_tiers"]["Row"];
export type Room = Database["booking"]["Tables"]["rooms"]["Row"];
export type RoomWithType = Room & { room_type: Pick<RoomType, "id" | "name"> | null };
export type RoomTypePhoto = Database["booking"]["Tables"]["room_type_photos"]["Row"];
export type RoomTypeWithTiers = RoomType & {
  rate_tiers: RateTier[];
  room_type_photos: RoomTypePhoto[];
};

// Reads run under RLS as the signed-in user (room_types/rate_tiers/rooms/
// room_type_photos are public-read). Tiers and photos come back sorted for
// stable display.
const TYPE_SELECT = "*, rate_tiers(*), room_type_photos(*)";

function sortTiers(t: RoomTypeWithTiers): RoomTypeWithTiers {
  return {
    ...t,
    rate_tiers: [...(t.rate_tiers ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    room_type_photos: [...(t.room_type_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  };
}

export async function listRoomTypes(): Promise<RoomTypeWithTiers[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("room_types").select(TYPE_SELECT).order("name");
  return ((data as RoomTypeWithTiers[] | null) ?? []).map(sortTiers);
}

export async function getRoomType(id: string): Promise<RoomTypeWithTiers | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("room_types").select(TYPE_SELECT).eq("id", id).maybeSingle();
  return data ? sortTiers(data as RoomTypeWithTiers) : null;
}

// Active types only — used to populate the "add room" and booking pickers.
export async function listActiveRoomTypes(): Promise<RoomTypeWithTiers[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("room_types")
    .select(TYPE_SELECT)
    .eq("is_active", true)
    .order("name");
  return ((data as RoomTypeWithTiers[] | null) ?? [])
    .map(sortTiers)
    .map((t) => ({ ...t, rate_tiers: t.rate_tiers.filter((r) => r.is_active) }));
}

export async function listRoomsWithType(): Promise<RoomWithType[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rooms")
    .select("*, room_type:room_types(id, name)")
    .order("label");
  return (data as RoomWithType[] | null) ?? [];
}

export type RoomWithOccupancy = RoomWithType & { occupancy: RoomOccupancy };

// Rooms plus who is in each one, derived from bookings rather than read off
// `rooms.status` — see occupancy.ts for why those are two different things.
//
// Two booking queries, not one: in-house stays are unbounded in the past (a
// guest checked in last week is still in the room) while future arrivals are
// unbounded forward, so a single date filter can't express both. `checked_in`
// is inherently a small set, and the arrivals query is clipped to today.
export async function listRoomsWithOccupancy(): Promise<RoomWithOccupancy[]> {
  const supabase = await createClient();
  const now = new Date();
  // Today AT THE INN — the arrivals clip below is a calendar day in Bayugan,
  // which on the UTC server would have started at 8 AM. See lib/inn-time.ts.
  const dayStart = innStartOfDay(now);
  const dayEnd = innAddDays(dayStart, 1);

  const BOOKING_SELECT = "id, room_id, status, guest_name, period";
  const [{ data: rooms }, { data: inHouse }, { data: arriving }] = await Promise.all([
    supabase.from("rooms").select("*, room_type:room_types(id, name)").order("label"),
    supabase.from("bookings").select(BOOKING_SELECT).eq("status", "checked_in"),
    supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .in("status", ["confirmed", "pending_verification"])
      .overlaps("period", `[${dayStart.toISOString()},${dayEnd.toISOString()})`),
  ]);

  const bookings: OccupancyBooking[] = [...(inHouse ?? []), ...(arriving ?? [])].map((b) => {
    const row = b as typeof b & { period: string };
    const { checkIn, checkOut } = parsePeriod(row.period);
    return {
      id: row.id,
      roomId: row.room_id,
      status: row.status,
      guestName: row.guest_name,
      checkIn,
      checkOut,
    };
  });

  return ((rooms as RoomWithType[] | null) ?? []).map((room) => ({
    ...room,
    occupancy: deriveOccupancy(room.id, bookings, now),
  }));
}
