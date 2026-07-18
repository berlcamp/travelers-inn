import { createAdminClient } from "@/lib/supabase/admin";
import { quote, type StayType } from "@/features/bookings/pricing";
import type { RoomType } from "@/features/rooms/repository";

export type AvailabilityOption = {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  nightlyRate: number;
  hourlyRate: number | null;
  available: number;
  units: number;
  total: number;
  unitLabel: string;
  priceError: string | null;
};

// Portal reads go through the admin client (server-only) so fn_count_available
// stays off the anon grant list. Room types themselves are public-readable.
export async function listActiveRoomTypesPublic(): Promise<RoomType[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("room_types").select("*").eq("is_active", true).order("name");
  return data ?? [];
}

export async function getRoomTypePublic(id: string): Promise<RoomType | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("room_types")
    .select("*")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  return data ?? null;
}

// For each active room type, how many rooms are free in the window and what the
// stay would cost. Hourly types without an hourly rate are omitted for hourly.
export async function listPortalAvailability(
  checkInISO: string,
  checkOutISO: string,
  stayType: StayType
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
      const q = quote(
        stayType,
        new Date(checkInISO),
        new Date(checkOutISO),
        Number(t.nightly_rate),
        t.hourly_rate != null ? Number(t.hourly_rate) : null
      );
      const hasPrice = "total" in q;
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        capacity: t.capacity,
        nightlyRate: Number(t.nightly_rate),
        hourlyRate: t.hourly_rate != null ? Number(t.hourly_rate) : null,
        available: (count as number) ?? 0,
        units: hasPrice ? q.units : 0,
        total: hasPrice ? q.total : 0,
        unitLabel: hasPrice ? q.unitLabel : "",
        priceError: hasPrice ? null : q.error,
      } satisfies AvailabilityOption;
    })
  );

  // For hourly searches, drop types that don't offer an hourly rate.
  return options.filter((o) => !(stayType === "hourly" && o.priceError));
}
