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
      checkOut: Date; // always derived: check-in + duration, or noon on the date
      unitLabel: string; // "3 hrs" | "1 night" | "2 nights"
    }
  | { error: string };

const MS_PER_NIGHT = 86_400_000;

/** The hour an overnight stay is due out. The house rule everywhere: the
 *  dashboard and the reports both measure a night as 14:00 → next 12:00. */
export const CHECK_OUT_HOUR = 12;

/** Noon on the date of `d`, in local wall-clock. An overnight guest leaves at
 *  midday whatever hour the desk happened to type — only the DATE is a choice.
 *  (Leaving earlier is recorded at check-out; see stay-window.ts.) */
export function checkOutAtNoon(d: Date): Date {
  const out = new Date(d);
  out.setHours(CHECK_OUT_HOUR, 0, 0, 0);
  return out;
}

/** The same rule on the strings the forms speak: "YYYY-MM-DD" (a date input)
 *  or "YYYY-MM-DDTHH:mm" (a datetime-local one) → "YYYY-MM-DDT12:00". Kept as
 *  string surgery rather than a Date round-trip because `new Date("2026-08-18")`
 *  is parsed as UTC midnight, which is the previous day in Manila. */
export function checkOutValue(local: string): string {
  const date = local.slice(0, 10);
  return date ? `${date}T${String(CHECK_OUT_HOUR).padStart(2, "0")}:00` : local;
}

// Mirrors the SQL math in booking.fn_create_booking exactly so the form preview
// matches the authoritative price:
//   block     → checkOut = checkIn + duration_hours; total = price + excessOnce
//   overnight → checkOut = noon on the chosen date (the desk picks the date,
//               never the hour); nights = ceil(ms/86400000), min 1;
//               total = (price + excess_rate × excessHeads) × nights
// The snap happens BEFORE the nights maths, and the callers send that same
// snapped check-out to fn_create_booking, so the SQL prices exactly what the
// preview showed.
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
  // Only the DATE is chosen — an overnight stay is always due out at noon, so
  // the time is snapped before it can reach the price or the room's window.
  const derivedOut = checkOutAtNoon(checkOut);
  const ms = derivedOut.getTime() - checkIn.getTime();
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
    checkOut: derivedOut,
    unitLabel: `${nights} ${nights === 1 ? "night" : "nights"}`,
  };
}

export const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
