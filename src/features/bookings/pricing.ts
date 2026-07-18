export type StayType = "nightly" | "hourly";

export type Quote =
  | { units: number; total: number; unitLabel: string }
  | { error: string };

// Mirrors the SQL math in booking.fn_create_booking exactly (ceil, min 1,
// 86400/3600 seconds) so the form preview matches the authoritative price.
export function quote(
  stayType: StayType,
  checkIn: Date,
  checkOut: Date,
  nightlyRate: number,
  hourlyRate: number | null
): Quote {
  const ms = checkOut.getTime() - checkIn.getTime();
  if (!(ms > 0)) return { error: "Check-out must be after check-in." };

  if (stayType === "nightly") {
    const units = Math.max(1, Math.ceil(ms / 86_400_000));
    return { units, total: units * nightlyRate, unitLabel: units === 1 ? "night" : "nights" };
  }

  if (hourlyRate == null) return { error: "This room type has no hourly rate." };
  const units = Math.max(1, Math.ceil(ms / 3_600_000));
  return { units, total: units * hourlyRate, unitLabel: units === 1 ? "hour" : "hours" };
}

export const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
