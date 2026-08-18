// Where a booking may go from where it is, and the exact words used to ask.
//
// There are now TWO places staff move a booking's status — the dropdown on the
// Status column of /bookings, and the lifecycle buttons in the manage dialog —
// so the list of legal moves and the confirmation copy live here, once. Two
// surfaces offering different moves, or warning about different consequences
// for the same move, is a worse bug than either surface being wrong: staff
// would learn one of them and be surprised by the other.
//
// A move is offered ONLY when the server action behind it accepts the booking's
// current status. `transition()` in front-desk-actions.ts refuses anything else
// outright (`Booking is not confirmed.`), so an option that isn't in this table
// is an option that would fail — and offering a status change that bounces is
// how staff stop trusting the control.
//
// `pending_verification` therefore has NO moves. Confirming one means checking
// the deposit and recording the amount that was actually paid
// (`confirmBooking` in verification-actions.ts takes that figure), and
// rejecting one writes the reason — neither is a thing a status dropdown can
// ask for. Both live in the verification panel inside the manage dialog. The
// three finished statuses have no moves for the plainer reason that nothing
// follows them.
//
// This module is deliberately import-free so it runs under
// `node --experimental-strip-types`: dates arrive already formatted (see
// TransitionContext), so there is no clock in here to get wrong.

/** The statuses staff can move a booking TO from these surfaces. Each one maps
 *  to exactly one existing server action — see apply-transition.ts. */
export type TransitionTarget = "checked_in" | "checked_out" | "no_show" | "cancelled";

export type BookingTransition = {
  to: TransitionTarget;
  /** Menu item and button text. Every one is a verb phrase naming the booking:
   *  a menu item reading just "Cancel" is read as "dismiss this menu". */
  label: string;
  /** Text on the confirm button in the modal. */
  confirmLabel: string;
  /** Question at the top of the modal. */
  title: string;
  /** Toast on success. */
  success: string;
  /** Undoes nothing and takes something away — drawn in the quieter/destructive
   *  tone so it isn't the button a thumb lands on by accident. */
  destructive: boolean;
};

/** Everything the confirmation sentence needs, resolved by the caller.
 *  `checkInText`/`checkOutText` are ALREADY formatted on the inn's clock
 *  (`innFormatter`) — this module never touches a Date. */
export type TransitionContext = {
  guestName: string;
  /** "" when no room is assigned. */
  roomLabel: string;
  checkInText: string;
  checkOutText: string;
};

const TRANSITIONS: Record<TransitionTarget, BookingTransition> = {
  checked_in: {
    to: "checked_in",
    label: "Check in",
    confirmLabel: "Check in",
    title: "Check in this guest?",
    success: "Checked in.",
    destructive: false,
  },
  checked_out: {
    to: "checked_out",
    label: "Check out",
    confirmLabel: "Check out",
    title: "Check out this guest?",
    success: "Checked out.",
    destructive: false,
  },
  no_show: {
    to: "no_show",
    label: "Mark as no-show",
    confirmLabel: "Mark no-show",
    title: "Mark as no-show?",
    success: "Marked no-show.",
    destructive: true,
  },
  cancelled: {
    to: "cancelled",
    label: "Cancel booking",
    confirmLabel: "Cancel booking",
    title: "Cancel this booking?",
    success: "Booking cancelled.",
    destructive: true,
  },
};

// Ordered the way the desk works: the ordinary next step first, then the two
// ways a stay fails. An unlisted status has no moves at all — see the note
// above about `pending_verification` and the finished statuses.
const BY_STATUS: Record<string, TransitionTarget[]> = {
  confirmed: ["checked_in", "no_show", "cancelled"],
  checked_in: ["checked_out", "cancelled"],
  pending_verification: [],
  checked_out: [],
  cancelled: [],
  no_show: [],
};

/**
 * The moves offered for a booking in `status`, in the order to display them.
 *
 * An UNKNOWN status returns nothing. That is the opposite of the choice
 * `booking-order.ts` makes for an unknown status (it sorts to the top, where a
 * new enum value is a visible nuisance) and for the same reason: there, being
 * wrong costs a row in an odd position; here it would cost staff a control
 * that answers with an error.
 *
 * Returns a fresh array each call — the caller may sort or filter it without
 * quietly rewriting this table.
 */
export function allowedTransitions(status: string): BookingTransition[] {
  return (BY_STATUS[status] ?? []).map((to) => TRANSITIONS[to]);
}

function roomPhrase(roomLabel: string): string {
  return roomLabel ? `room ${roomLabel}` : "the room";
}

/**
 * The sentence under the modal's title. Each one names the consequence that is
 * easy to forget rather than restating what the button says.
 */
export function transitionDescription(to: TransitionTarget, ctx: TransitionContext): string {
  const room = roomPhrase(ctx.roomLabel);
  switch (to) {
    case "checked_in":
      // The booked arrival is spelled out because the same control is used on
      // advance bookings: the availability page hands the walk-in dialog a
      // FUTURE window, so a confirmed booking in this list may well be for
      // next Saturday.
      return `${ctx.guestName} takes ${room} now, and it is marked occupied. Booked arrival is ${ctx.checkInText}.`;
    case "checked_out":
      // Check-out stamps the REAL departure time over the booked window
      // (stay-window.ts), so pressing this an hour early records an hour early.
      return `${ctx.guestName} leaves ${room}. The departure is recorded as now, not the booked ${ctx.checkOutText}, and the room goes to cleaning.`;
    case "no_show":
      // No-show deliberately keeps whatever the guest paid in revenue
      // (analytics.countsAsRevenue) — that money was forfeited, not returned.
      return `${ctx.guestName} did not arrive. This frees ${room} and keeps anything already paid. It cannot be undone.`;
    case "cancelled":
      // Cancelling is the one that moves money: a payment against a cancelled
      // booking stops counting everywhere (dashboard, /reports, /collections).
      return `${ctx.guestName}'s booking is cancelled. This frees ${room} and takes any payment on it back out of revenue. It cannot be undone.`;
  }
}
