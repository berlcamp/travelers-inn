import { z } from "zod";

export const PAYMENT_METHODS = ["cash", "gcash", "card", "bank_transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  gcash: "GCash",
  card: "Card",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export const paymentSchema = z.object({
  booking_id: z.string().uuid(),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(80).optional().or(z.literal("")),
});
export type PaymentFormValues = z.input<typeof paymentSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
