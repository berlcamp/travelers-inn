import { z } from "zod";

// Walk-in / staff booking form. check_in/check_out are datetime-local strings
// (local wall-clock, no timezone) converted to ISO in the action.
export const bookingSchema = z.object({
  guest_name: z.string().trim().min(1, "Guest name is required").max(120),
  guest_phone: z.string().trim().max(40).optional().or(z.literal("")),
  guest_email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  room_type_id: z.string().uuid("Select a room type"),
  stay_type: z.enum(["nightly", "hourly"]),
  check_in: z.string().min(1, "Check-in is required"),
  check_out: z.string().min(1, "Check-out is required"),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
export type BookingFormValues = z.input<typeof bookingSchema>;
export type BookingInput = z.infer<typeof bookingSchema>;

export const BOOKING_STATUSES = [
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
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

export const STAY_TYPE_LABELS: Record<"nightly" | "hourly", string> = {
  nightly: "Nightly",
  hourly: "Hourly",
};
