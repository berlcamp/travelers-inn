"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/shared/form-fields";
import {
  portalBookingSchema,
  type PortalBookingFormValues,
  type PortalBookingInput,
} from "@/features/portal/schemas";
import { createPortalBooking } from "@/features/portal/actions";

export function PortalBookingForm({
  roomTypeId,
  roomTypeName,
  stay,
  checkIn,
  checkOut,
  stayLabel,
}: {
  roomTypeId: string;
  roomTypeName: string;
  stay: "nightly" | "hourly";
  checkIn: string;
  checkOut: string;
  stayLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const form = useForm<PortalBookingFormValues, unknown, PortalBookingInput>({
    resolver: zodResolver(portalBookingSchema),
    defaultValues: {
      guest_name: "",
      guest_phone: "",
      guest_email: "",
      room_type_id: roomTypeId,
      stay_type: stay,
      check_in: checkIn,
      check_out: checkOut,
    },
  });

  function onSubmit(values: PortalBookingInput) {
    startTransition(async () => {
      const result = await createPortalBooking(values);
      if (result.ok) {
        setConfirmed(result.data.reference_code);
      } else {
        toast.error(result.error);
      }
    });
  }

  if (confirmed) {
    return (
      <div className="border-border bg-card flex flex-col items-center gap-4 rounded-2xl border p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <PartyPopper className="size-7" />
        </div>
        <div>
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold">
            You&apos;re booked!
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {roomTypeName} · {stayLabel}
          </p>
        </div>
        <div className="bg-muted/60 w-full rounded-xl p-4">
          <div className="text-muted-foreground text-xs uppercase tracking-wide">
            Your reference
          </div>
          <div className="font-[family-name:var(--font-fraunces)] text-primary text-3xl font-semibold tracking-wide">
            {confirmed}
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          Show this reference at the front desk on arrival to pay and collect your key.
        </p>
        <Button nativeButton={false} render={<Link href="/" />} variant="outline">
          Book another stay
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FormInput control={form.control} name="guest_name" label="Full name" placeholder="Juan dela Cruz" />
      <FormInput control={form.control} name="guest_phone" label="Contact number" placeholder="09xx xxx xxxx" />
      <FormInput control={form.control} name="guest_email" label="Email (optional)" placeholder="you@example.com" />
      <Button type="submit" size="lg" disabled={pending} className="mt-1">
        {pending ? (
          "Confirming…"
        ) : (
          <>
            <CheckCircle2 className="size-4" /> Confirm booking
          </>
        )}
      </Button>
      <p className="text-muted-foreground text-center text-xs">
        No payment now — pay at the front desk on arrival.
      </p>
    </form>
  );
}
