"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { BedDouble, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormInput, FormSelect, FormTextarea } from "@/components/shared/form-fields";
import {
  bookingSchema,
  type BookingFormValues,
  type BookingInput,
} from "@/features/bookings/schemas";
import { createBooking, checkAvailability } from "@/features/bookings/actions";
import { quote, peso, type RateTier } from "@/features/bookings/pricing";
import type { RoomTypeWithTiers } from "@/features/rooms/repository";

// "YYYY-MM-DDTHH:mm" in local wall-clock, for datetime-local inputs.
function localDateTime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaults(): BookingFormValues {
  const checkIn = new Date();
  checkIn.setHours(13, 0, 0, 0);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 1);
  checkOut.setHours(12, 0, 0, 0);
  return {
    guest_name: "",
    guest_phone: "",
    guest_email: "",
    room_type_id: "",
    rate_tier_id: "",
    guest_count: 1,
    check_in: localDateTime(checkIn),
    check_out: localDateTime(checkOut),
    notes: "",
  };
}

const dtFmt = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function WalkInDialog({
  trigger,
  roomTypes,
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
  roomTypes: RoomTypeWithTiers[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [available, setAvailable] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  const form = useForm<BookingFormValues, unknown, BookingInput>({
    resolver: zodResolver(bookingSchema),
    defaultValues: defaults(),
  });

  const typeOptions = roomTypes.map((t) => ({ value: t.id, label: t.name }));

  const [roomTypeId, rateTierId, guestCount, checkIn, checkOut] = useWatch({
    control: form.control,
    name: ["room_type_id", "rate_tier_id", "guest_count", "check_in", "check_out"],
  });

  const selectedType = roomTypes.find((t) => t.id === roomTypeId) ?? null;
  const tierOptions = (selectedType?.rate_tiers ?? []).map((t) => ({
    value: t.id,
    label: `${t.label} · ${peso.format(Number(t.price))}`,
  }));
  const selectedTier = selectedType?.rate_tiers.find((t) => t.id === rateTierId) ?? null;
  const isBlock = selectedTier?.kind === "block";

  // When the room type changes, the current tier no longer belongs to it —
  // default its first tier and reset the guest count to the base occupancy.
  useEffect(() => {
    if (!selectedType) return;
    const tierBelongs = selectedType.rate_tiers.some((t) => t.id === rateTierId);
    if (!tierBelongs) {
      form.setValue("rate_tier_id", selectedType.rate_tiers[0]?.id ?? "");
      form.setValue("guest_count", selectedType.base_occupancy);
    }
  }, [selectedType, rateTierId, form]);

  const priceQuote = useMemo(() => {
    if (!selectedType || !selectedTier || !checkIn) return null;
    const tier: RateTier = {
      id: selectedTier.id,
      label: selectedTier.label,
      kind: selectedTier.kind,
      duration_hours: selectedTier.duration_hours,
      price: Number(selectedTier.price),
    };
    return quote(
      tier,
      {
        base_occupancy: selectedType.base_occupancy,
        max_occupancy: selectedType.max_occupancy,
        excess_person_rate: Number(selectedType.excess_person_rate),
      },
      Number(guestCount) || 0,
      new Date(checkIn),
      isBlock ? null : checkOut ? new Date(checkOut) : null
    );
  }, [selectedType, selectedTier, guestCount, checkIn, checkOut, isBlock]);

  // The effective check-out used for availability + submission (derived for
  // blocks). `null` when we can't compute one yet.
  const effectiveCheckOut =
    priceQuote && "checkOut" in priceQuote ? priceQuote.checkOut : null;

  // Debounced availability check whenever type/tier/dates/guests change.
  useEffect(() => {
    let cancelled = false;
    const outIso = effectiveCheckOut ? localDateTime(effectiveCheckOut) : null;
    const handle = setTimeout(async () => {
      if (!roomTypeId || !checkIn || !outIso) {
        if (!cancelled) setAvailable(null);
        return;
      }
      if (!cancelled) setChecking(true);
      const result = await checkAvailability(roomTypeId, checkIn, outIso);
      if (!cancelled) {
        setAvailable(result.ok ? result.data.count : 0);
        setChecking(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [roomTypeId, checkIn, effectiveCheckOut]);

  const priceError = priceQuote && "error" in priceQuote ? priceQuote.error : null;
  const canSubmit = !pending && available != null && available > 0 && !priceError;

  function onSubmit(values: BookingInput) {
    startTransition(async () => {
      // For blocks the server derives check-out; clear the stale value.
      const payload = isBlock ? { ...values, check_out: "" } : values;
      const result = await createBooking(payload);
      if (result.ok) {
        toast.success(`Booked — ${result.data.reference_code}`);
        setOpen(false);
        form.reset(defaults());
        setAvailable(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New walk-in booking</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormInput control={form.control} name="guest_name" label="Guest name" placeholder="Juan dela Cruz" />
          <div className="grid grid-cols-2 gap-3">
            <FormInput control={form.control} name="guest_phone" label="Phone" placeholder="09xx…" />
            <FormInput control={form.control} name="guest_email" label="Email" placeholder="optional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormSelect
              control={form.control}
              name="room_type_id"
              label="Room type"
              options={typeOptions}
              placeholder="Choose a type"
            />
            <FormSelect
              control={form.control}
              name="rate_tier_id"
              label="Rate"
              options={tierOptions}
              placeholder={selectedType ? "Choose a rate" : "Pick a type first"}
              disabled={!selectedType}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormInput
              control={form.control}
              name="guest_count"
              label={
                selectedType
                  ? `Guests (max ${selectedType.max_occupancy})`
                  : "Guests"
              }
              type="number"
              min={1}
            />
            <FormInput
              control={form.control}
              name="check_in"
              label="Check-in"
              type="datetime-local"
            />
          </div>
          {!isBlock ? (
            <FormInput
              control={form.control}
              name="check_out"
              label="Check-out"
              type="datetime-local"
            />
          ) : null}
          <FormTextarea control={form.control} name="notes" label="Notes" rows={2} />

          <SummaryPanel
            checking={checking}
            available={available}
            derivedCheckout={
              isBlock && effectiveCheckOut ? dtFmt.format(effectiveCheckOut) : null
            }
            priceLine={
              priceError
                ? priceError
                : priceQuote && "total" in priceQuote
                  ? summarize(priceQuote)
                  : null
            }
            priceError={Boolean(priceError)}
          />

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? "Booking…" : "Confirm booking"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function summarize(q: Extract<ReturnType<typeof quote>, { total: number }>): string {
  const parts = [q.unitLabel];
  if (q.excessTotal > 0) parts.push(`+${q.excessHeads} guest${q.excessHeads === 1 ? "" : "s"}`);
  return `${parts.join(" · ")} — ${peso.format(q.total)}`;
}

function SummaryPanel({
  checking,
  available,
  derivedCheckout,
  priceLine,
  priceError,
}: {
  checking: boolean;
  available: number | null;
  derivedCheckout: string | null;
  priceLine: string | null;
  priceError: boolean;
}) {
  return (
    <div className="bg-muted/50 flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex items-center gap-2">
        <BedDouble className="text-muted-foreground size-4" />
        {checking ? (
          <span className="text-muted-foreground">Checking availability…</span>
        ) : available == null ? (
          <span className="text-muted-foreground">Pick a room type, rate and dates.</span>
        ) : available > 0 ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> {available} room{available === 1 ? "" : "s"} free
          </span>
        ) : (
          <span className="text-destructive inline-flex items-center gap-1">
            <XCircle className="size-4" /> No rooms free for those dates
          </span>
        )}
      </div>
      {derivedCheckout ? (
        <div className="text-muted-foreground text-xs">Checks out {derivedCheckout}</div>
      ) : null}
      {priceLine ? (
        <div className={priceError ? "text-destructive" : "font-medium"}>{priceLine}</div>
      ) : null}
    </div>
  );
}
