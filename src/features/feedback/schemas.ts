import { z } from "zod";

export const feedbackSchema = z.object({
  room_id: z.string().uuid(),
  rating: z.coerce.number().int().min(1, "Please choose a rating").max(5),
  comment: z.string().trim().max(1000).optional().or(z.literal("")),
  guest_name: z.string().trim().max(120).optional().or(z.literal("")),
});
export type FeedbackFormValues = z.input<typeof feedbackSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;
