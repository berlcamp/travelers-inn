// Who is in a room right now, derived from bookings. Pure — no I/O — so it
// unit-tests under `node --experimental-strip-types`, same as pricing.ts and
// analytics.ts; the only import allowed is another pure module, relative and
// with its .ts extension so Node's resolver can find it.
import { innSameDay } from "../../lib/inn-time.ts";
//
// This exists because a room's `status` column is HOUSEKEEPING state, not
// occupancy: check-in writes `occupied` and check-out writes `cleaning`
// (features/bookings/front-desk-actions.ts), but nothing about who is in the
// room can be read back out of it reliably — a stale value is just a wrong
// word on a screen. Occupancy is a fact about bookings, so it's computed from
// bookings every time it's shown and never stored.
//
// The definitions match the dashboard's (features/reports/reports.ts) on
// purpose: in-house means `checked_in`, arriving means a check-in dated today.
// Two screens disagreeing about whether room 103 is occupied is worse than
// either being slightly coarse.

export type OccupancyBooking = {
  id: string;
  roomId: string;
  status: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
};

export type RoomOccupancy =
  | {
      kind: "in_house";
      bookingId: string;
      guestName: string;
      /** Checking out today — the room frees up within hours. */
      departingToday: boolean;
    }
  | {
      kind: "arriving";
      bookingId: string;
      guestName: string;
      /** A portal booking whose deposit nobody has verified yet. It still
       *  HOLDS the room (see the no_overlap constraint), so it is never shown
       *  as free — but the clerk should know it isn't finalised. */
      awaitingDeposit: boolean;
    }
  | { kind: "free" };

export type OccupancyKind = RoomOccupancy["kind"];

export const OCCUPANCY_LABELS: Record<OccupancyKind, string> = {
  in_house: "In house",
  arriving: "Arriving today",
  free: "Free",
};

// Statuses that put a guest in a room today. `pending_verification` is here
// for the same reason it's in the exclusion constraint: that guest has paid a
// deposit and the room is theirs.
const ARRIVING = ["confirmed", "pending_verification"];

// "Today" is today AT THE INN (src/lib/inn-time.ts) — on the UTC server the
// calendar day rolled over at 8 AM, so an evening arrival read as tomorrow's.
const sameDay = innSameDay;

export function deriveOccupancy(
  roomId: string,
  bookings: OccupancyBooking[],
  now: Date
): RoomOccupancy {
  const mine = bookings.filter((b) => b.roomId === roomId);

  // A checked-in guest outranks an arrival: on a same-day turnover the room is
  // occupied until they actually leave, and telling the desk otherwise would
  // invite walking a second guest into an occupied room.
  const inHouse = mine.find((b) => b.status === "checked_in");
  if (inHouse) {
    const out = new Date(inHouse.checkOut);
    return {
      kind: "in_house",
      bookingId: inHouse.id,
      guestName: inHouse.guestName,
      departingToday: !Number.isNaN(out.getTime()) && sameDay(out, now),
    };
  }

  const arrivals = mine
    .filter((b) => ARRIVING.includes(b.status))
    .filter((b) => {
      const at = new Date(b.checkIn);
      return !Number.isNaN(at.getTime()) && sameDay(at, now);
    })
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  const next = arrivals[0];
  if (next) {
    return {
      kind: "arriving",
      bookingId: next.id,
      guestName: next.guestName,
      awaitingDeposit: next.status === "pending_verification",
    };
  }

  return { kind: "free" };
}
