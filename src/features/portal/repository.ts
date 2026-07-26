import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicSettings } from "@/features/settings/repository";
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
  photos: { url: string }[];
  available: number;
  fromPrice: number; // cheapest tier, shown as a "from" teaser
};

const TYPE_SELECT = "*, rate_tiers(*), room_type_photos(*)";

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
    room_type_photos: [...(t.room_type_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order),
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
    photos: (t.room_type_photos ?? []).map((p) => ({ url: p.url })),
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

// Private storage bucket for deposit proofs (screenshots/PDFs). Not a "use
// server" export — actions.ts can only export async functions there — but
// this is the one place both the portal action and a future staff
// verification panel can share the bucket name from.
export const PROOF_BUCKET = "travelers-inn-payment-proofs";

export type PortalPaymentInfo = {
  gcash_name: string;
  gcash_number: string;
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  deposit_percent: number;
};

// Payment details shown on the booking page. Falls back to 50% if the setting
// is blank or unparseable so the deposit step never renders a NaN. This is
// not a "0 means no deposit" path: the settings form/schema floor
// deposit_percent at 1, since the whole portal flow (proof upload,
// pending_verification, the staff verify queue) has no "skip the deposit"
// mode — so a stored 0 can only mean missing/corrupt data, never deliberate
// admin intent, and 50% is the right fallback.
export async function getPortalPaymentInfo(): Promise<PortalPaymentInfo> {
  const s = await getPublicSettings();
  const pct = Number(s.deposit_percent);
  return {
    gcash_name: s.gcash_name,
    gcash_number: s.gcash_number,
    bank_name: s.bank_name,
    bank_account_name: s.bank_account_name,
    bank_account_number: s.bank_account_number,
    deposit_percent: Number.isFinite(pct) && pct > 0 ? pct : 50,
  };
}
