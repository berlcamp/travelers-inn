"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { toast } from "sonner";
import { Minus, Plus, Upload, ShieldCheck, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/shared/form-fields";
import { createPortalBookingWithProof } from "@/features/portal/actions";
import { depositFor } from "@/features/bookings/deposit";
import { quote, peso, type RateTier } from "@/features/bookings/pricing";
import type { AvailabilityOption, PortalPaymentInfo } from "@/features/portal/repository";

const contactSchema = z.object({
  guest_name: z.string().trim().min(1, "Please enter your name").max(120),
  guest_phone: z.string().trim().min(7, "Please enter a contact number").max(40),
  guest_email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  method: z.enum(["gcash", "bank_transfer"]),
  reference_no: z.string().trim().min(3, "Enter the reference number").max(80),
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
  payment,
}: {
  option: AvailabilityOption;
  roomTypeName: string;
  checkIn: string;
  checkOut: string;
  payment: PortalPaymentInfo;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState<{ code: string; deposit: number } | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);

  const checkInDate = checkIn.slice(0, 10);
  const [tierId, setTierId] = useState(option.tiers[0]?.id ?? "");
  const [guestCount, setGuestCount] = useState(option.base_occupancy);
  const [nights, setNights] = useState(() => nightsBetween(checkIn, checkOut));

  const form = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      guest_name: "",
      guest_phone: "",
      guest_email: "",
      method: "gcash",
      reference_no: "",
    },
  });

  const method = form.watch("method");

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

  const total = priceQuote && "total" in priceQuote ? priceQuote.total : 0;
  const deposit = depositFor(total, payment.deposit_percent);

  function onSubmit(contact: ContactValues) {
    if (!tier || priceError) return;
    if (!proofFile) {
      setProofError("Please attach your proof of payment.");
      return;
    }
    setProofError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("guest_name", contact.guest_name);
      fd.set("guest_phone", contact.guest_phone);
      fd.set("guest_email", contact.guest_email ?? "");
      fd.set("room_type_id", option.id);
      fd.set("rate_tier_id", tier.id);
      fd.set("guest_count", String(guestCount));
      fd.set("check_in", checkInISO);
      fd.set("check_out", isOvernight ? checkOutISO : "");
      fd.set("method", contact.method);
      fd.set("reference_no", contact.reference_no);
      fd.set("proof", proofFile);

      const result = await createPortalBookingWithProof(fd);
      if (result.ok) {
        setConfirmed({ code: result.data.reference_code, deposit: result.data.deposit });
      } else {
        toast.error(result.error);
      }
    });
  }

  if (confirmed) {
    return (
      <div className="border-border bg-card flex flex-col items-center gap-4 rounded-2xl border p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
          <ShieldCheck className="size-7" />
        </div>
        <div>
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold">
            Reserved — we&apos;re verifying your payment
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {roomTypeName} · {tier?.label}
          </p>
        </div>
        <div className="bg-muted/60 w-full rounded-xl p-4">
          <div className="text-muted-foreground text-xs uppercase tracking-wide">Your reference</div>
          <div className="font-[family-name:var(--font-fraunces)] text-primary text-3xl font-semibold tracking-wide">
            {confirmed.code}
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          Your room is held. We&apos;ve received your proof of the {peso.format(confirmed.deposit)}{" "}
          deposit and will confirm by text once we&apos;ve checked it — usually within a few hours.
          Settle the balance at the front desk on arrival.
        </p>
        <Button nativeButton={false} render={<Link href="/" />} variant="outline">
          Book another stay
        </Button>
      </div>
    );
  }

  // Sold out only matters before a booking is made — the confirmed branch above
  // always wins, so a successful booking of the last room still shows the code.
  if (option.available <= 0) {
    return (
      <div className="border-border bg-card flex flex-col items-center gap-4 rounded-2xl border p-8 text-center">
        <h3 className="font-[family-name:var(--font-fraunces)] text-xl font-semibold">
          Just booked out
        </h3>
        <p className="text-muted-foreground text-sm">
          Sorry — {roomTypeName} has no rooms free for these dates. Try another room or time.
        </p>
        <Button nativeButton={false} render={<Link href="/" />} variant="outline">
          Search rooms
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

      {/* Deposit */}
      <div className="border-border flex flex-col gap-3 rounded-xl border p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">Pay a deposit to reserve</span>
          <span className="text-primary text-xl font-semibold">{peso.format(deposit)}</span>
        </div>
        <p className="text-muted-foreground text-xs">
          {payment.deposit_percent}% of {peso.format(total)}. The balance is paid at the front desk.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {(["gcash", "bank_transfer"] as const).map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => form.setValue("method", m)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                method === m
                  ? "border-primary ring-primary/30 bg-primary/5 ring-1"
                  : "border-border hover:border-foreground/20"
              }`}
            >
              {m === "gcash" ? "GCash" : "Bank transfer"}
            </button>
          ))}
        </div>

        <div className="bg-muted/50 rounded-lg p-3 text-sm">
          {method === "gcash" ? (
            <>
              <div className="text-muted-foreground text-xs">Send to GCash</div>
              <div className="font-medium">{payment.gcash_number || "—"}</div>
              <div className="text-muted-foreground text-xs">{payment.gcash_name}</div>
            </>
          ) : (
            <>
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Landmark className="size-3.5" /> Bank transfer
              </div>
              <div className="font-medium">{payment.bank_account_number || "—"}</div>
              <div className="text-muted-foreground text-xs">
                {payment.bank_account_name}
                {payment.bank_name ? ` · ${payment.bank_name}` : ""}
              </div>
            </>
          )}
        </div>

        <FormInput
          control={form.control}
          name="reference_no"
          label="Reference number"
          placeholder="From your GCash / bank receipt"
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Proof of payment</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="file:bg-muted file:text-foreground text-muted-foreground w-full text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-2 file:text-sm file:font-medium"
            onChange={(e) => {
              setProofFile(e.target.files?.[0] ?? null);
              setProofError(null);
            }}
          />
          <span className="text-muted-foreground text-xs">
            Screenshot or PDF · JPEG, PNG, WebP, or PDF up to 5 MB
          </span>
          {proofError ? <span className="text-destructive text-xs">{proofError}</span> : null}
        </div>
      </div>

      <Button type="submit" size="lg" disabled={pending || Boolean(priceError)} className="mt-1">
        {pending ? (
          "Submitting…"
        ) : (
          <>
            <Upload className="size-4" /> Reserve &amp; submit payment
          </>
        )}
      </Button>
      <p className="text-muted-foreground text-center text-xs">
        Your room is held while we verify your deposit.
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
