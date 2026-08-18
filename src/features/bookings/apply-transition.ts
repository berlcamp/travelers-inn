import { checkIn, checkOut, markNoShow } from "@/features/bookings/front-desk-actions";
import { cancelBooking } from "@/features/bookings/actions";
import type { ActionResult } from "@/lib/action-result";
import type { TransitionTarget } from "@/features/bookings/booking-transitions";

/**
 * One target status → the one server action that performs it.
 *
 * Kept apart from `booking-transitions.ts` because that module stays
 * import-free so it can be unit-tested; this is the half that has to reach the
 * server. Nothing new happens here — every branch is an action that already
 * existed, with its own `requireRole` guard, its own status precondition, its
 * own room-housekeeping write and its own audit entry. The dropdown and the
 * manage dialog are two ways to press the SAME buttons, which is why neither
 * needed a new "set status" action: a generic one would have had to re-derive
 * the side effects each of these already owns (the room going to
 * occupied/cleaning, the real check-out time stamped over the booked window).
 */
export function applyTransition(
  to: TransitionTarget,
  bookingId: string
): Promise<ActionResult<{ id: string }>> {
  switch (to) {
    case "checked_in":
      return checkIn(bookingId);
    case "checked_out":
      return checkOut(bookingId);
    case "no_show":
      return markNoShow(bookingId);
    case "cancelled":
      return cancelBooking(bookingId);
  }
}
