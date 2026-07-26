import { createAdminClient } from "@/lib/supabase/admin";

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
