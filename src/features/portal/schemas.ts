import { z } from "zod";

// Public booking form. A contact number is required (staff follow up on
// arrival / no-shows); email is optional.
export const portalBookingSchema = z.object({
  guest_name: z.string().trim().min(1, "Please enter your name").max(120),
  guest_phone: z.string().trim().min(7, "Please enter a contact number").max(40),
  guest_email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  room_type_id: z.string().uuid(),
  stay_type: z.enum(["nightly", "hourly"]),
  check_in: z.string().min(1),
  check_out: z.string().min(1),
});
export type PortalBookingFormValues = z.input<typeof portalBookingSchema>;
export type PortalBookingInput = z.infer<typeof portalBookingSchema>;
