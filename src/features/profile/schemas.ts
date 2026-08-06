import { z } from "zod";

// Mirrors the guards inside booking.fn_update_my_profile: same trim, same
// bounds. The function stays authoritative — this exists so the form can say
// "Name is required" without a round trip, not so the server can trust it.
export const profileSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(120, "Keep it under 120 characters"),
});

export type ProfileFormValues = z.input<typeof profileSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
