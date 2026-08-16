// The stay window as a Postgres range literal. Pure and import-free so it runs
// under `node --experimental-strip-types` (supabase/tests/stay-window.test.ts).
//
// `bookings.period` is the authoritative window — check_in/check_out are read
// back out of it (repository.parsePeriod). A booked window is a PLAN: a block
// tier derives its end from the tier's duration (17:00 + 12h → 05:00 the next
// day), an overnight one ends at the standard noon. What actually happened is
// only known when staff check the guest out, which is what this stamps.

/** The window a stay should carry once the guest has actually left, or null if
 *  the actual time can't be stamped and the booked window must stand. */
export function actualStayWindow(
  checkIn: string,
  actualOut: Date
): { period: string; checkOut: string } | null {
  const inAt = new Date(checkIn);
  if (!checkIn || Number.isNaN(inAt.getTime()) || Number.isNaN(actualOut.getTime())) return null;

  // A guest can be checked in EARLY — before the hour they booked — and then
  // leave again before it. Stamping that would make check-out precede
  // check-in: an empty range, which `bookings_period_valid` rejects and which
  // would fail the whole check-out rather than record it. The booked window
  // stands instead, and the audit entry still says who checked them out.
  if (actualOut.getTime() <= inAt.getTime()) return null;

  const checkOut = actualOut.toISOString();
  // Postgres tstzrange literal, half-open like every other window in this
  // schema: the room is free again the instant the guest walks out.
  return { period: `["${inAt.toISOString()}","${checkOut}")`, checkOut };
}
