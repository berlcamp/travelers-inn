// Turns an audit_logs row into the sentence the activity trail shows. Pure and
// unit-tested: the trail is the record staff and owners read to answer "who did
// this", so a wrong or missing label is a real failure, not a cosmetic one.
import { peso } from "./pricing";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "./payment-schema";
import { innFormatter } from "@/lib/inn-time";

export const BOOKING_SOURCE_LABELS: Record<string, string> = {
  walk_in: "Walk-in",
  portal: "Online portal",
  staff: "Staff",
};

const ACTION_LABELS: Record<string, string> = {
  "booking.create": "Booking taken",
  "booking.verify_confirm": "Deposit verified — confirmed",
  "booking.verify_reject": "Deposit rejected — cancelled",
  "booking.check_in": "Checked in",
  "booking.check_out": "Checked out",
  "booking.no_show": "Marked no-show",
  "booking.cancel": "Booking cancelled",
  // Never rendered in a booking's own trail — the row is gone, so the dialog
  // that would show it can't be opened. Mapped anyway: this table is what
  // turns an audit action into a sentence, and a deleted booking's entry is
  // the one entry that outlives what it describes.
  "booking.delete": "Booking deleted",
  "booking.reassign_room": "Room reassigned",
  "payment.record": "Payment received",
};

function asRecord(diff: unknown): Record<string, unknown> {
  return diff && typeof diff === "object" && !Array.isArray(diff)
    ? (diff as Record<string, unknown>)
    : {};
}

function money(value: unknown): string | null {
  const n = Number(value);
  return Number.isFinite(n) ? peso.format(n) : null;
}

const whenFmt = innFormatter({
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function when(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : whenFmt.format(d);
}

export type TrailDescription = { label: string; detail: string | null };

// An unknown action falls back to its raw name rather than being hidden: a
// trail that silently drops entries is worse than one that shows a bare slug.
export function describeTrailEntry(action: string, diff: unknown): TrailDescription {
  const d = asRecord(diff);
  const label = ACTION_LABELS[action] ?? action;

  switch (action) {
    case "booking.create": {
      const source = typeof d.source === "string" ? BOOKING_SOURCE_LABELS[d.source] : null;
      return { label, detail: source ?? null };
    }
    case "payment.record": {
      const amount = money(d.amount);
      const method =
        typeof d.method === "string"
          ? (PAYMENT_METHOD_LABELS[d.method as PaymentMethod] ?? d.method)
          : null;
      return { label, detail: [amount, method].filter(Boolean).join(" · ") || null };
    }
    case "booking.verify_confirm": {
      const amount = money(d.amount);
      const reference = typeof d.reference === "string" && d.reference ? d.reference : null;
      return { label, detail: [amount, reference].filter(Boolean).join(" · ") || null };
    }
    case "booking.check_out": {
      // Check-out overwrites the booked window with the real one, so this is
      // the only place the booked time survives. Only present when it moved.
      const scheduled = when(d.scheduled_check_out);
      if (!scheduled) return { label, detail: null };
      const late =
        typeof d.actual_check_out === "string" &&
        typeof d.scheduled_check_out === "string" &&
        new Date(d.actual_check_out) > new Date(d.scheduled_check_out);
      return { label, detail: `${late ? "Late" : "Early"} — was due ${scheduled}` };
    }
    case "booking.verify_reject": {
      const reason = typeof d.reason === "string" && d.reason ? d.reason : null;
      return { label, detail: reason };
    }
    default:
      return { label, detail: null };
  }
}
