import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database.types";

export type FeedbackRow = Database["booking"]["Tables"]["feedback"]["Row"];
export type FeedbackWithRoom = FeedbackRow & {
  room: { label: string; room_type: { name: string } | null } | null;
};

// Public lookup for the QR landing page. Anonymous, so it goes through the
// admin client like every other portal read.
export async function getRoomPublic(
  roomId: string
): Promise<{ id: string; label: string; typeName: string | null } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("rooms")
    .select("id, label, room_type:room_types(name)")
    .eq("id", roomId)
    .maybeSingle();
  if (!data) return null;
  const rt = data.room_type as { name: string } | null;
  return { id: data.id, label: data.label, typeName: rt?.name ?? null };
}

// Staff-side read under RLS.
export async function listFeedback(): Promise<FeedbackWithRoom[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("feedback")
    .select("*, room:rooms(label, room_type:room_types(name))")
    .order("created_at", { ascending: false });
  return (data as FeedbackWithRoom[] | null) ?? [];
}

export type FeedbackStats = { count: number; average: number; last30: number };

// Pure so it can be reasoned about without a DB round-trip.
export function computeFeedbackStats(rows: FeedbackRow[], now = new Date()): FeedbackStats {
  if (rows.length === 0) return { count: 0, average: 0, last30: 0 };
  const total = rows.reduce((acc, r) => acc + r.rating, 0);
  const cutoff = now.getTime() - 30 * 86_400_000;
  return {
    count: rows.length,
    average: Math.round((total / rows.length) * 10) / 10,
    last30: rows.filter((r) => new Date(r.created_at).getTime() >= cutoff).length,
  };
}
