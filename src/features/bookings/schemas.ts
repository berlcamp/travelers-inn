import { z } from "zod";
import { PAYMENT_METHODS } from "./payment-schema";

// Walk-in / staff booking form. check_in/check_out are datetime-local strings
// (local wall-clock, no timezone) converted to ISO in the action. For block
// tiers check_out is derived server-side, so it may be empty here.
//
// A walk-in guest pays the full price at the desk, so the payment is part of
// this form rather than a second step in the manage dialog. There is
// deliberately NO amount field: neither a part payment nor an overpayment is
// allowed, so the recorded amount is always the booking's server-computed
// `quoted_total` — staff choose only how the money came in.
export const bookingSchema = z.object({
  guest_name: z.string().trim().min(1, "Guest name is required").max(120),
  guest_phone: z.string().trim().max(40).optional().or(z.literal("")),
  guest_email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  room_type_id: z.string().uuid("Select a room type"),
  rate_tier_id: z.string().uuid("Select a rate"),
  // Optional override. Empty means "any free room of this type", which is the
  // default and lets fn_create_booking pick — see 20260808000100.
  room_id: z.string().uuid().optional().or(z.literal("")),
  guest_count: z.coerce.number().int().min(1, "At least 1 guest").max(50),
  check_in: z.string().min(1, "Check-in is required"),
  check_out: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
  payment_method: z.enum(PAYMENT_METHODS),
  payment_reference: z.string().trim().max(80).optional().or(z.literal("")),
});
export type BookingFormValues = z.input<typeof bookingSchema>;
export type BookingInput = z.infer<typeof bookingSchema>;

/**
 * Everything the "Booking confirmed" panel puts on screen, and nothing else.
 *
 * It lives here — not in repository.ts — because BOTH sides need it: the
 * walk-in action builds one to hand back, and the client dialog renders it.
 * `BookingRow` satisfies it structurally, so the manage dialog (which already
 * holds a full row after re-reading a verified booking) still passes its row
 * straight in without an adapter.
 *
 * The point of the shape is that a walk-in no longer needs a SECOND request to
 * learn its own room number: the labels come back with the booking that was
 * just created.
 */
export type ConfirmedBooking = {
  reference_code: string;
  guest_name: string;
  guest_count: number;
  quoted_total: number | string;
  checkIn: string;
  checkOut: string;
  room: { label: string } | null;
  room_type: { name: string } | null;
  rate_tier: { label: string } | null;
};

export const BOOKING_STATUSES = [
  "pending_verification",
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending_verification: "For verification",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const PAYMENT_STATUS_LABELS: Record<"unpaid" | "partial" | "paid", string> = {
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
};
