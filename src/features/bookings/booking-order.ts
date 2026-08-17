// The order the /bookings list is read in.
//
// It used to be `order by period desc` in SQL, which sorts a tstzrange by its
// lower bound — so the top of the list was whichever stay starts FURTHEST in
// the future. A reservation for September sat above tonight's arrivals, and
// the guests actually in the building were near the bottom, because they
// checked in earliest of anyone. The list was sorted by something no one at
// the desk was ever asking about.
//
// What a front desk asks, in this order: who is in the building, who is coming
// next, and — only then — what already happened. So:
//
//   BAND 0  in-house      (checked_in)                       earliest arrival first
//   BAND 1  still to come (pending_verification, confirmed)   soonest arrival first
//   BAND 2  finished      (checked_out, cancelled, no_show)   most recent first
//
// A booking awaiting deposit verification sits in band 1 by its arrival date
// like any other — it isn't more urgent than a guest arriving tonight, and the
// amber "For verification" badge plus the pending count on the page already
// point at it.
//
// Bands are decided by STATUS ALONE, never by comparing a date to `now`. That
// is deliberate: the order is then a pure function of the rows, identical on
// the server and after any re-render, with no clock to drift and nothing to
// re-sort as the day passes. It also means a `confirmed` booking whose arrival
// has already passed — someone who never turned up and was never marked
// no-show — sorts to the TOP of band 1 rather than vanishing into history.
// That is the intended behaviour: it is the oldest unanswered arrival, and it
// wants either a check-in or a no-show.
//
// Pure and dependency-free so it unit-tests under
// `node --experimental-strip-types` (supabase/tests/booking-order.test.ts).

/** The least a row needs for the desk order. BookingRow satisfies it. */
export type OrderableBooking = {
  status: string;
  checkIn: string;
  checkOut: string;
  reference_code: string;
};

const IN_HOUSE = ["checked_in"];
const FINISHED = ["checked_out", "cancelled", "no_show"];

/** 0 = in the building, 1 = still to come, 2 = over and done with. */
export function bandOf(status: string): number {
  if (IN_HOUSE.includes(status)) return 0;
  if (FINISHED.includes(status)) return 2;
  // Anything else — including a status added to the enum later — is treated as
  // live. A new status showing up mid-list is a nuisance; one silently buried
  // under the cancellations is a booking nobody serves.
  return 1;
}

/** Milliseconds, or null when the timestamp is unusable. The strings come from
 *  Postgres and carry their offset, so this is an absolute instant and needs no
 *  timezone handling (unlike anything the FORMS produce — see lib/inn-time.ts). */
function at(iso: string): number | null {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Rows in the order the front desk reads them. Returns a new array; the input
 *  is left alone (the calendar shares the same fetch). */
export function sortForFrontDesk<T extends OrderableBooking>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const bandA = bandOf(a.status);
    const bandB = bandOf(b.status);
    if (bandA !== bandB) return bandA - bandB;

    const inA = at(a.checkIn);
    const inB = at(b.checkIn);
    // A row with an unreadable window keeps its place among its own band
    // rather than being flung to one end — it is a data problem, not a
    // scheduling one, and the reference code below still orders it stably.
    if (inA !== null && inB !== null && inA !== inB) {
      // Band 2 is history, so it reads newest-first; the other two read
      // forwards, towards the next thing that has to happen.
      return bandA === 2 ? inB - inA : inA - inB;
    }
    if ((inA === null) !== (inB === null)) return inA === null ? 1 : -1;

    // Two stays starting at the same moment: the one leaving sooner first, so
    // a turnover reads in the order the desk works it.
    const outA = at(a.checkOut);
    const outB = at(b.checkOut);
    if (outA !== null && outB !== null && outA !== outB) {
      return bandA === 2 ? outB - outA : outA - outB;
    }

    // Last resort, so the order is total: identical windows would otherwise
    // come back in whatever order Postgres happened to return them, and the
    // list would reshuffle between reloads for no visible reason.
    return a.reference_code.localeCompare(b.reference_code);
  });
}
