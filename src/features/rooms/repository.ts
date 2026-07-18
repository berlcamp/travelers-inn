import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

export type RoomType = Database["booking"]["Tables"]["room_types"]["Row"];
export type Room = Database["booking"]["Tables"]["rooms"]["Row"];
export type RoomWithType = Room & { room_type: Pick<RoomType, "id" | "name"> | null };

// Reads run under RLS as the signed-in user (room_types/rooms are public-read).

export async function listRoomTypes(): Promise<RoomType[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("room_types").select("*").order("name");
  return data ?? [];
}

export async function getRoomType(id: string): Promise<RoomType | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("room_types").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

// Active types only — used to populate the "add room" and booking pickers.
export async function listActiveRoomTypes(): Promise<RoomType[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("room_types")
    .select("*")
    .eq("is_active", true)
    .order("name");
  return data ?? [];
}

export async function listRoomsWithType(): Promise<RoomWithType[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rooms")
    .select("*, room_type:room_types(id, name)")
    .order("label");
  return (data as RoomWithType[] | null) ?? [];
}
