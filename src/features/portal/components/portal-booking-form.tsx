"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, PartyPopper, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/shared/form-fields";
import { createPortalBooking } from "@/features/portal/actions";
import { quote, peso, type RateTier } from "@/features/bookings/pricing";
import type { AvailabilityOption } from "@/features/portal/repository";

const contactSchema = z.object({
  guest_name: z.string().trim().min(1, "Please enter your name").max(120),
  guest_phone: z.string().trim().min(7, "Please enter a contact number").max(40),
  guest_email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
});
type ContactValues = z.infer<typeof contactSchema>;

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function addNights(dateStr: string, nights: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + nights);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T12:00`;
}
function nightsBetween(checkIn: string, checkOut: string) {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Number.isNaN(ms) ? 1 : Math.max(1, Math.ceil(ms / 86_400_000));
}

export function PortalBookingForm({
  option,
  roomTypeName,
  checkIn,
  checkOut,
}: {
  option: AvailabilityOption;
  roomTypeName: string;
  checkIn: string;
  checkOut: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const checkInDate = checkIn.slice(0, 10);
  const [tierId, setTierId] = useState(option.tiers[0]?.id ?? "");
  const [guestCount, setGuestCount] = useState(option.base_occupancy);
  const [nights, setNights] = useState(() => nightsBetween(checkIn, checkOut));

  const form = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { guest_name: "", guest_phone: "", guest_email: "" },
  });

  const tier = option.tiers.find((t) => t.id === tierId) ?? option.tiers[0];
  const isOvernight = tier?.kind === "overnight";

  const checkInISO = `${checkInDate}T13:00`;
  const checkOutISO = isOvernight ? addNights(checkInDate, nights) : "";

  const priceQuote = useMemo(() => {
    if (!tier) return null;
    const rt: RateTier = {
      id: tier.id,
      label: tier.label,
      kind: tier.kind,
      duration_hours: tier.duration_hours,
      price: tier.price,
    };
    return quote(
      rt,
      {
        base_occupancy: option.base_occupancy,
        max_occupancy: option.max_occupancy,
        excess_person_rate: option.excess_person_rate,
      },
      guestCount,
      new Date(checkInISO),
      isOvernight ? new Date(checkOutISO) : null
    );
  }, [tier, option, guestCount, checkInISO, checkOutISO, isOvernight]);

  const priceError = priceQuote && "error" in priceQuote ? priceQuote.error : null;

  function onSubmit(contact: ContactValues) {
    if (!tier || priceError) return;
    startTransition(async () => {
      const result = await createPortalBooking({
        ...contact,
        room_type_id: option.id,
        rate_tier_id: tier.id,
        guest_count: guestCount,
        check_in: checkInISO,
        check_out: isOvernight ? checkOutISO : "",
      });
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
            {roomTypeName} · {tier?.label}
          </p>
        </div>
        <div className="bg-muted/60 w-full rounded-xl p-4">
          <div className="text-muted-foreground text-xs uppercase tracking-wide">Your reference</div>
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
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
      {/* Rate tier */}
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Choose a rate
        </span>
        <div className="grid gap-2">
          {option.tiers.map((t) => {
            const active = t.id === tierId;
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => setTierId(t.id)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                  active
                    ? "border-primary ring-primary/30 bg-primary/5 ring-1"
                    : "border-border hover:border-foreground/20"
                }`}
              >
                <span className="text-sm font-medium">
                  {t.label}
                  {t.kind === "overnight" ? (
                    <span className="text-muted-foreground font-normal"> / night</span>
                  ) : null}
                </span>
                <span className="font-semibold">{peso.format(t.price)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Nights (overnight only) + guests */}
      <div className="grid grid-cols-2 gap-4">
        {isOvernight ? (
          <Stepper
            label="Nights"
            value={nights}
            min={1}
            max={30}
            onChange={setNights}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Duration
            </span>
            <div className="border-border flex h-11 items-center rounded-lg border px-3 text-sm">
              {tier?.duration_hours} hours
            </div>
          </div>
        )}
        <Stepper
          label={`Guests (max ${option.max_occupancy})`}
          value={guestCount}
          min={1}
          max={option.max_occupancy}
          onChange={setGuestCount}
        />
      </div>

      {/* Price summary */}
      <div className="bg-muted/50 flex flex-col gap-1 rounded-xl border p-4 text-sm">
        {priceError ? (
          <span className="text-destructive">{priceError}</span>
        ) : priceQuote && "total" in priceQuote ? (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {tier?.label}
                {priceQuote.nights ? ` · ${priceQuote.nights} night${priceQuote.nights === 1 ? "" : "s"}` : ""}
              </span>
              <span>{peso.format(priceQuote.roomTotal)}</span>
            </div>
            {priceQuote.excessTotal > 0 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  +{priceQuote.excessHeads} extra guest{priceQuote.excessHeads === 1 ? "" : "s"}
                </span>
                <span>{peso.format(priceQuote.excessTotal)}</span>
              </div>
            ) : null}
            <div className="border-border/70 mt-1 flex justify-between border-t pt-2 font-semibold">
              <span>Total</span>
              <span>{peso.format(priceQuote.total)}</span>
            </div>
          </>
        ) : null}
      </div>

      {/* Contact */}
      <FormInput control={form.control} name="guest_name" label="Full name" placeholder="Juan dela Cruz" />
      <FormInput control={form.control} name="guest_phone" label="Contact number" placeholder="09xx xxx xxxx" />
      <FormInput control={form.control} name="guest_email" label="Email (optional)" placeholder="you@example.com" />

      <Button type="submit" size="lg" disabled={pending || Boolean(priceError)} className="mt-1">
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

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </span>
      <div className="border-border flex h-11 items-center justify-between rounded-lg border px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={`Decrease ${label}`}
        >
          <Minus className="size-4" />
        </Button>
        <span className="text-sm font-medium tabular-nums">{value}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`Increase ${label}`}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}
