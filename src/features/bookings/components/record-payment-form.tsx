"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormInput, FormSelect } from "@/components/shared/form-fields";
import {
  paymentSchema,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentFormValues,
  type PaymentInput,
} from "@/features/bookings/payment-schema";
import { recordPayment } from "@/features/bookings/front-desk-actions";
import { peso } from "@/features/bookings/pricing";

export function RecordPaymentForm({
  bookingId,
  balance,
  onDone,
}: {
  bookingId: string;
  balance: number;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<PaymentFormValues, unknown, PaymentInput>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      booking_id: bookingId,
      amount: balance > 0 ? balance : ("" as unknown as number),
      method: "cash",
      reference: "",
    },
  });

  const methodOptions = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));

  function onSubmit(values: PaymentInput) {
    startTransition(async () => {
      const result = await recordPayment(values);
      if (result.ok) {
        toast.success("Payment recorded.");
        form.reset({ booking_id: bookingId, amount: "" as unknown as number, method: "cash", reference: "" });
        onDone();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <FormInput
          control={form.control}
          name="amount"
          label="Amount ₱"
          type="number"
          min={0}
          step="0.01"
        />
        <FormSelect control={form.control} name="method" label="Method" options={methodOptions} />
      </div>
      <FormInput
        control={form.control}
        name="reference"
        label="Reference (optional)"
        placeholder="OR / txn no."
      />
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          Balance due: <span className="font-medium">{peso.format(Math.max(0, balance))}</span>
        </span>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
