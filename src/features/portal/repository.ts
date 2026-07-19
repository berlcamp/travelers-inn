import { createAdminClient } from "@/lib/supabase/admin";
import type { RoomType, RateTier, RoomTypeWithTiers } from "@/features/rooms/repository";

export type PortalTier = Pick<RateTier, "id" | "label" | "kind" | "duration_hours" | "price">;

export type AvailabilityOption = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  base_occupancy: number;
  max_occupancy: number;
  excess_person_rate: number;
  tiers: PortalTier[];
  available: number;
  fromPrice: number; // cheapest tier, shown as a "from" teaser
};

const TYPE_SELECT = "*, rate_tiers(*)";

// Portal reads go through the admin client (server-only) so fn_count_available
// stays off the anon grant list. Room types themselves are public-readable.
export async function listActiveRoomTypesPublic(): Promise<RoomTypeWithTiers[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("room_types")
    .select(TYPE_SELECT)
    .eq("is_active", true)
    .order("name");
  return ((data as RoomTypeWithTiers[] | null) ?? []).map(withActiveTiers);
}

export async function getRoomTypePublic(id: string): Promise<RoomTypeWithTiers | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("room_types")
    .select(TYPE_SELECT)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  return data ? withActiveTiers(data as RoomTypeWithTiers) : null;
}

function withActiveTiers(t: RoomTypeWithTiers): RoomTypeWithTiers {
  return {
    ...t,
    rate_tiers: [...(t.rate_tiers ?? [])]
      .filter((r) => r.is_active)
      .sort((a, b) => a.sort_order - b.sort_order),
  };
}

function toOption(t: RoomTypeWithTiers, available: number): AvailabilityOption {
  const tiers: PortalTier[] = t.rate_tiers.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    duration_hours: r.duration_hours,
    price: Number(r.price),
  }));
  const fromPrice = tiers.length ? Math.min(...tiers.map((r) => r.price)) : 0;
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    imageUrl: t.image_url,
    base_occupancy: t.base_occupancy,
    max_occupancy: t.max_occupancy,
    excess_person_rate: Number(t.excess_person_rate),
    tiers,
    available,
    fromPrice,
  };
}

// For each active room type, how many rooms are free in the window plus its
// tiers/occupancy (so the book page can price any tier client-side). Types
// without any active tier are omitted — they can't be booked.
export async function listPortalAvailability(
  checkInISO: string,
  checkOutISO: string
): Promise<AvailabilityOption[]> {
  const admin = createAdminClient();
  const types = await listActiveRoomTypesPublic();

  const options = await Promise.all(
    types.map(async (t) => {
      const { data: count } = await admin.rpc("fn_count_available", {
        p_room_type_id: t.id,
        p_check_in: checkInISO,
        p_check_out: checkOutISO,
      });
      return toOption(t, (count as number) ?? 0);
    })
  );

  return options.filter((o) => o.tiers.length > 0);
}

export type { RoomType };
