export type TierKind = "block" | "overnight";

// The pricing inputs a quote needs. Mirrors booking.rate_tiers +
// booking.room_types occupancy columns.
export type RateTier = {
  id: string;
  label: string;
  kind: TierKind;
  duration_hours: number | null;
  price: number;
};

export type Occupancy = {
  base_occupancy: number;
  max_occupancy: number;
  excess_person_rate: number;
};

export type Quote =
  | {
      total: number;
      roomTotal: number;
      excessTotal: number;
      excessHeads: number;
      nights: number | null; // null for a fixed-duration block
      checkOut: Date; // derived for blocks, echoed for overnight
      unitLabel: string; // "3 hrs" | "1 night" | "2 nights"
    }
  | { error: string };

const MS_PER_NIGHT = 86_400_000;

// Mirrors the SQL math in booking.fn_create_booking exactly so the form preview
// matches the authoritative price:
//   block     → checkOut = checkIn + duration_hours; total = price + excessOnce
//   overnight → nights = ceil(ms/86400000), min 1;
//               total = (price + excess_rate × excessHeads) × nights
export function quote(
  tier: RateTier,
  occ: Occupancy,
  guestCount: number,
  checkIn: Date,
  checkOut?: Date | null
): Quote {
  if (!(guestCount >= 1)) return { error: "At least one guest is required." };
  if (guestCount > occ.max_occupancy) {
    return { error: `This room accommodates at most ${occ.max_occupancy} guests.` };
  }

  const excessHeads = Math.max(0, guestCount - occ.base_occupancy);
  const excessPerUnit = excessHeads * occ.excess_person_rate;

  if (tier.kind === "block") {
    const hours = tier.duration_hours ?? 0;
    const derivedOut = new Date(checkIn.getTime() + hours * 3_600_000);
    return {
      roomTotal: tier.price,
      excessTotal: excessPerUnit,
      excessHeads,
      total: tier.price + excessPerUnit,
      nights: null,
      checkOut: derivedOut,
      unitLabel: tier.label,
    };
  }

  if (!checkOut) return { error: "Choose a check-out date." };
  const ms = checkOut.getTime() - checkIn.getTime();
  if (!(ms > 0)) return { error: "Check-out must be after check-in." };
  const nights = Math.max(1, Math.ceil(ms / MS_PER_NIGHT));
  const roomTotal = tier.price * nights;
  const excessTotal = excessPerUnit * nights;
  return {
    roomTotal,
    excessTotal,
    excessHeads,
    total: roomTotal + excessTotal,
    nights,
    checkOut,
    unitLabel: `${nights} ${nights === 1 ? "night" : "nights"}`,
  };
}

export const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
