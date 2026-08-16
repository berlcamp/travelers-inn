import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";
import { listActiveRoomTypes, listRoomsWithType } from "@/features/rooms/repository";
import { quote, checkOutAtNoon, type TierKind } from "./pricing";

type BookingBase = Database["booking"]["Tables"]["bookings"]["Row"];

export type BookingRow = BookingBase & {
  room: { label: string } | null;
  room_type: { name: string } | null;
  rate_tier: { label: string } | null;
  checkIn: string;
  checkOut: string;
  // Filled in by listBookingsWithStaff / getBookingWithPayments; plain
  // listBookings leaves them undefined (the calendar has no use for them).
  createdByName?: string | null;
  verifiedByName?: string | null;
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
    return {
      ...(b as BookingBase & {
        room: { label: string } | null;
        room_type: { name: string } | null;
        rate_tier: { label: string } | null;
      }),
      checkIn,
      checkOut,
    };
  });
}

export async function getBooking(id: string): Promise<BookingRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("bookings").select(SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const { checkIn, checkOut } = parsePeriod((data as { period: string }).period);
  return {
    ...(data as BookingBase & {
      room: { label: string } | null;
      room_type: { name: string } | null;
      rate_tier: { label: string } | null;
    }),
    checkIn,
    checkOut,
  };
}

// Staff ids → display names, via fn_staff_names (SECURITY DEFINER: front desk
// can read colleagues' NAMES without gaining read access to profiles, which
// carry emails). Ids with no profile — a portal booking's null created_by, or
// a staff member whose auth user was deleted — simply don't come back.
export async function resolveStaffNames(
  ids: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.rpc("fn_staff_names", { p_ids: unique });
  return new Map((data ?? []).map((r) => [r.staff_id, r.staff_name]));
}

// The bookings list shows who handled each booking, so it resolves names in one
// extra round-trip for the whole page rather than per row.
export async function listBookingsWithStaff(): Promise<BookingRow[]> {
  const bookings = await listBookings();
  const names = await resolveStaffNames(bookings.flatMap((b) => [b.created_by, b.verified_by]));
  return bookings.map((b) => ({
    ...b,
    createdByName: b.created_by ? (names.get(b.created_by) ?? null) : null,
    verifiedByName: b.verified_by ? (names.get(b.verified_by) ?? null) : null,
  }));
}

export type Payment = Database["booking"]["Tables"]["payments"]["Row"];
export type PaymentWithStaff = Payment & { recordedByName: string | null };

export function sumPaid(payments: Payment[]): number {
  return payments.reduce((acc, p) => acc + Number(p.amount), 0);
}

export type TrailEntry = {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  diff: unknown;
  createdAt: string;
};

// Per-booking activity, actor names already joined. fn_booking_trail is scoped
// to one booking's audit rows, so this never exposes the rest of audit_logs
// (settings, invitations, roles) — which stays admin-only.
export async function listBookingTrail(bookingId: string): Promise<TrailEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("fn_booking_trail", { p_booking_id: bookingId });
  return (data ?? []).map((row) => ({
    id: row.entry_id,
    action: row.action,
    actorId: row.actor_id,
    actorName: row.actor_name,
    diff: row.diff,
    createdAt: row.created_at,
  }));
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

export type ProofRow = Database["booking"]["Tables"]["booking_proofs"]["Row"];

// Latest proof on file for a booking (a guest could in theory upload more than
// once server-side, so take the most recent).
export async function getProof(bookingId: string): Promise<ProofRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("booking_proofs")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export type BookingDetail = {
  booking: BookingRow;
  payments: PaymentWithStaff[];
  paid: number;
  availableRooms: { id: string; label: string }[];
  proof: ProofRow | null;
  trail: TrailEntry[];
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

async function countAvailable(
  roomTypeId: string,
  checkIn: Date,
  checkOut: Date
): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("fn_count_available", {
    p_room_type_id: roomTypeId,
    p_check_in: checkIn.toISOString(),
    p_check_out: checkOut.toISOString(),
  });
  return (data as number | null) ?? 0;
}

// ---- Availability lookup ---------------------------------------------------
// What staff need when a guest calls or walks up to ask "do you have a room?".
// The answer is per RATE, not per date range: a block tier runs for its own
// fixed duration from the arrival time, so its window is never the one the
// caller typed. Each tier therefore carries its own window, its own price for
// this party size, and its own free count — the same three numbers the walk-in
// dialog would compute after the fact.

export type TierAvailability = {
  id: string;
  label: string;
  kind: TierKind;
  checkIn: Date;
  checkOut: Date;
  /** Null when this party can't be quoted (over the room's max occupancy). */
  price: number | null;
  unitLabel: string;
  free: number;
};

export type TypeAvailability = {
  id: string;
  name: string;
  base_occupancy: number;
  max_occupancy: number;
  excess_person_rate: number;
  roomCount: number;
  outOfService: number;
  /** Rooms free across the window the caller typed (blocks fit inside it). */
  freeRooms: { id: string; label: string }[];
  /** False when the party exceeds max_occupancy — the type can't take them. */
  fits: boolean;
  tiers: TierAvailability[];
};

export async function searchAvailability(
  checkIn: Date,
  checkOut: Date,
  guests: number
): Promise<TypeAvailability[]> {
  const [types, rooms] = await Promise.all([listActiveRoomTypes(), listRoomsWithType()]);

  return Promise.all(
    types.map(async (t) => {
      const occ = {
        base_occupancy: t.base_occupancy,
        max_occupancy: t.max_occupancy,
        excess_person_rate: Number(t.excess_person_rate),
      };
      const typeRooms = rooms.filter((r) => r.room_type_id === t.id);
      const freeRooms = await listAvailableRooms(
        t.id,
        checkIn.toISOString(),
        checkOut.toISOString(),
        null
      );

      const tiers = await Promise.all(
        t.rate_tiers.map(async (tier): Promise<TierAvailability> => {
          // The window is a property of the tier, not of the search: a block
          // ends duration_hours after arrival whatever check-out was typed,
          // and an overnight ends at noon on the searched check-out date
          // whatever hour was typed. Both come back from quote() below, so the
          // card shows the window the booking will actually get.
          const tierOut =
            tier.kind === "block"
              ? new Date(checkIn.getTime() + (tier.duration_hours ?? 0) * 3_600_000)
              : checkOutAtNoon(checkOut);
          const q = quote(
            {
              id: tier.id,
              label: tier.label,
              kind: tier.kind,
              duration_hours: tier.duration_hours,
              price: Number(tier.price),
            },
            occ,
            guests,
            checkIn,
            tierOut
          );
          // The room list already fetched above answers any tier whose window
          // IS the searched one; a block ends earlier, and an overnight whose
          // hour was snapped to noon ends elsewhere too, so those are counted
          // over their own window rather than assumed.
          const free =
            tierOut.getTime() === checkOut.getTime()
              ? freeRooms.length
              : await countAvailable(t.id, checkIn, tierOut);
          return {
            id: tier.id,
            label: tier.label,
            kind: tier.kind,
            checkIn,
            checkOut: tierOut,
            price: "total" in q ? q.total : null,
            unitLabel: "unitLabel" in q ? q.unitLabel : tier.label,
            free,
          };
        })
      );

      return {
        id: t.id,
        name: t.name,
        base_occupancy: t.base_occupancy,
        max_occupancy: t.max_occupancy,
        excess_person_rate: Number(t.excess_person_rate),
        roomCount: typeRooms.length,
        outOfService: typeRooms.filter((r) => r.status === "out_of_service").length,
        freeRooms,
        fits: guests <= t.max_occupancy,
        tiers,
      };
    })
  );
}

// Drives the "N awaiting verification" prompt on the bookings page.
export async function countPendingVerification(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_verification");
  return count ?? 0;
}

export async function getBookingWithPayments(id: string): Promise<BookingDetail | null> {
  const booking = await getBooking(id);
  if (!booking) return null;
  const [payments, trail] = await Promise.all([listPayments(id), listBookingTrail(id)]);
  const availableRooms =
    booking.status === "pending_verification" ||
    booking.status === "confirmed" ||
    booking.status === "checked_in"
      ? await listAvailableRooms(
          booking.room_type_id,
          booking.checkIn,
          booking.checkOut,
          booking.id
        )
      : [];
  const proof = booking.status === "pending_verification" ? await getProof(id) : null;

  // One lookup covers every actor the dialog names: who took the booking, who
  // verified the deposit, and who received each payment.
  const names = await resolveStaffNames([
    booking.created_by,
    booking.verified_by,
    ...payments.map((p) => p.recorded_by),
  ]);

  return {
    booking: {
      ...booking,
      createdByName: booking.created_by ? (names.get(booking.created_by) ?? null) : null,
      verifiedByName: booking.verified_by ? (names.get(booking.verified_by) ?? null) : null,
    },
    payments: payments.map((p) => ({
      ...p,
      recordedByName: p.recorded_by ? (names.get(p.recorded_by) ?? null) : null,
    })),
    paid: sumPaid(payments),
    availableRooms,
    proof,
    trail,
  };
}
