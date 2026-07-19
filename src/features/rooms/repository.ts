import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

export type RoomType = Database["booking"]["Tables"]["room_types"]["Row"];
export type RateTier = Database["booking"]["Tables"]["rate_tiers"]["Row"];
export type Room = Database["booking"]["Tables"]["rooms"]["Row"];
export type RoomWithType = Room & { room_type: Pick<RoomType, "id" | "name"> | null };
export type RoomTypeWithTiers = RoomType & { rate_tiers: RateTier[] };

// Reads run under RLS as the signed-in user (room_types/rate_tiers/rooms are
// public-read). Tiers come back sorted for stable display.
const TYPE_SELECT = "*, rate_tiers(*)";

function sortTiers(t: RoomTypeWithTiers): RoomTypeWithTiers {
  return {
    ...t,
    rate_tiers: [...(t.rate_tiers ?? [])].sort((a, b) => a.sort_order - b.sort_order),
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
