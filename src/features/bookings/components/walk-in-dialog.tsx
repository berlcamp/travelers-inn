"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { BedDouble, CheckCircle2, Wallet, XCircle } from "lucide-react";
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
  type ConfirmedBooking,
} from "@/features/bookings/schemas";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/features/bookings/payment-schema";
import { createBooking, listFreeRooms } from "@/features/bookings/actions";
import { BookingConfirmedDialog } from "./booking-confirmed-dialog";
import { quote, peso, checkOutValue, type RateTier } from "@/features/bookings/pricing";
import type { RoomTypeWithTiers } from "@/features/rooms/repository";
import {
  fromInnClock,
  innAddDays,
  innClockValue,
  innDateValue,
  innFormatter,
} from "@/lib/inn-time";

// "YYYY-MM-DDTHH:mm" on the INN's clock, for datetime-local inputs. Pinned
// rather than taken from the browser because the server reads these strings
// back as inn time (features/bookings/actions.ts) — a clerk on a laptop set to
// another zone would otherwise book an hour they never typed.
const localDateTime = innClockValue;

// The check-out field holds a DATE only: an overnight stay is due out at noon
// (pricing.checkOutValue), so there is no hour for the desk to choose. Prefill
// arriving from the availability page is a datetime-local string, hence the
// slice rather than a plain pass-through.
function dateOnly(value: string) {
  return value.slice(0, 10);
}

/** The earliest check-out the desk can pick: the day after arrival. Stops a
 *  same-day overnight, which would price a night the guest never sleeps. */
function nightAfter(checkIn: string) {
  const d = fromInnClock(checkIn);
  if (Number.isNaN(d.getTime())) return undefined;
  return innDateValue(innAddDays(d, 1));
}

// What the availability page hands over when staff press "Book" on a result,
// so the guest never has to be asked for dates twice.
export type WalkInPrefill = Partial<
  Pick<
    BookingFormValues,
    "room_type_id" | "rate_tier_id" | "guest_count" | "check_in" | "check_out"
  >
>;

/** Now, to the minute — the seconds are noise in a datetime-local field. */
function nowAtTheInn(): Date {
  return new Date(Math.floor(Date.now() / 60_000) * 60_000);
}

function defaults(prefill?: WalkInPrefill): BookingFormValues {
  // A walk-in is standing at the counter, so arrival is NOW rather than the
  // 13:00 standard check-in this used to assume: the clerk was retyping the
  // hour on every booking taken outside that one minute of the day. (The
  // availability page still defaults to 13:00 — that one answers "do you have
  // a room tonight?", which is a question about a future arrival.)
  const checkIn = nowAtTheInn();
  const checkOut = innAddDays(checkIn, 1);
  const merged: BookingFormValues = {
    guest_name: "",
    guest_phone: "",
    guest_email: "",
    room_type_id: "",
    rate_tier_id: "",
    // Empty = let the server pick any free room of the type, which is what
    // nearly every walk-in wants.
    room_id: "",
    guest_count: 1,
    check_in: localDateTime(checkIn),
    check_out: dateOnly(localDateTime(checkOut)),
    notes: "",
    payment_method: "cash",
    payment_reference: "",
    ...prefill,
  };
  // Prefill comes from the availability search as a datetime-local string;
  // this field is a date input, which renders empty for anything else.
  return { ...merged, check_out: dateOnly(merged.check_out ?? "") };
}

const ANY_ROOM_LABEL = "Any free room";

const dtFmt = innFormatter({
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function WalkInDialog({
  trigger,
  roomTypes,
  prefill,
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
  roomTypes: RoomTypeWithTiers[];
  prefill?: WalkInPrefill;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [freeRooms, setFreeRooms] = useState<{ id: string; label: string }[] | null>(null);
  const [checking, setChecking] = useState(false);
  // Set once the booking exists; drives the "which room do they walk to" panel.
  const [confirmed, setConfirmed] = useState<{
    booking: ConfirmedBooking;
    paid: number;
  } | null>(null);
  const available = freeRooms?.length ?? null;

  const form = useForm<BookingFormValues, unknown, BookingInput>({
    resolver: zodResolver(bookingSchema),
    defaultValues: defaults(prefill),
  });

  const typeOptions = roomTypes.map((t) => ({ value: t.id, label: t.name }));
  const methodOptions = PAYMENT_METHODS.map((m) => ({
    value: m,
    label: PAYMENT_METHOD_LABELS[m],
  }));

  const [roomTypeId, rateTierId, guestCount, checkIn, checkOut, roomId] = useWatch({
    control: form.control,
    name: ["room_type_id", "rate_tier_id", "guest_count", "check_in", "check_out", "room_id"],
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
      fromInnClock(checkIn),
      // checkOutValue turns the field's date into local noon — parsing the
      // bare "YYYY-MM-DD" would read it as UTC midnight, a day early here.
      isBlock ? null : checkOut ? fromInnClock(checkOutValue(checkOut)) : null
    );
  }, [selectedType, selectedTier, guestCount, checkIn, checkOut, isBlock]);

  // The effective check-out used for availability + submission (derived for
  // blocks). `null` when we can't compute one yet.
  const effectiveCheckOut = priceQuote && "checkOut" in priceQuote ? priceQuote.checkOut : null;

  // Debounced availability check whenever type/tier/dates/guests change, and
  // only while the dialog is open: the availability page renders one of these
  // per bookable rate, so a closed dialog must cost nothing. Clearing on close
  // also stops a reopened dialog from briefly trusting a stale count.
  useEffect(() => {
    let cancelled = false;
    if (!open) return;
    const outIso = effectiveCheckOut ? localDateTime(effectiveCheckOut) : null;
    const handle = setTimeout(async () => {
      if (!roomTypeId || !checkIn || !outIso) {
        if (!cancelled) setFreeRooms(null);
        return;
      }
      if (!cancelled) setChecking(true);
      const result = await listFreeRooms(roomTypeId, checkIn, outIso);
      if (!cancelled) {
        setFreeRooms(result.ok ? result.data.rooms : []);
        setChecking(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, roomTypeId, checkIn, effectiveCheckOut]);

  // "Any free room" is a real option rather than a cleared select, so choosing
  // it back is one click — Base UI's Select has no built-in way to unset.
  const roomOptions = [
    { value: "", label: ANY_ROOM_LABEL },
    ...(freeRooms ?? []).map((r) => ({ value: r.id, label: `Room ${r.label}` })),
  ];

  // A named room can stop being free while the clerk is still typing, and the
  // type/date fields can change under it. Falling back to "any" beats leaving a
  // selection that the server will only reject on submit.
  const chosenRoomGone = !!roomId && freeRooms != null && !freeRooms.some((r) => r.id === roomId);
  useEffect(() => {
    if (chosenRoomGone) form.setValue("room_id", "");
  }, [chosenRoomGone, form]);

  // `defaults()` runs at mount and after a booking, but the bookings page sits
  // open all shift — by mid-afternoon its "now" would be whatever hour the
  // clerk first loaded the page. So the arrival is re-stamped each time the
  // dialog opens.
  //
  // Only when the field is untouched, and never over a prefill from the
  // availability page: both are a deliberate statement about WHEN, and quietly
  // resetting either would move a booking the clerk believes they already set.
  useEffect(() => {
    if (!open || prefill?.check_in) return;
    if (form.getFieldState("check_in").isDirty) return;
    form.setValue("check_in", localDateTime(nowAtTheInn()));
  }, [open, prefill?.check_in, form]);

  const priceError = priceQuote && "error" in priceQuote ? priceQuote.error : null;
  const totalDue = priceQuote && "total" in priceQuote ? priceQuote.total : null;
  const canSubmit = !pending && available != null && available > 0 && !priceError;

  function onSubmit(values: BookingInput) {
    startTransition(async () => {
      // For blocks the server derives check-out; clear the stale value.
      const payload = isBlock ? { ...values, check_out: "" } : values;
      const result = await createBooking(payload);
      if (result.ok) {
        const { reference_code, paid, paymentError, confirmation } = result.data;
        if (paymentError) {
          // The room is held but the money isn't on the ledger — say so
          // plainly; staff finish the payment from the booking's manage dialog.
          toast.error(
            `Booked ${reference_code}, but the payment was NOT recorded: ${paymentError}. Record it from the booking.`
          );
        } else {
          toast.success(`Booked ${reference_code} — paid in full (${peso.format(paid)})`);
        }

        // The room number comes back WITH the booking, so the panel opens on
        // the same response that created it. It used to be a second server
        // action (loadBookingDetail) — its own auth round trip and five
        // queries — run while the guest stood at the counter waiting to be
        // told which room was theirs.
        //
        // There is deliberately NO router.refresh() here. createBooking calls
        // revalidatePath("/bookings"), and Next re-renders the page INSIDE the
        // action's own response — measured: revalidate alone is one request and
        // one render, revalidate + refresh is two of each, the second paying
        // the proxy's auth round trip again for a list nobody is looking at
        // yet. The list behind this panel is already up to date.
        setConfirmed({ booking: confirmation, paid });
        setOpen(false);
        form.reset(defaults(prefill));
        setFreeRooms(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Drop the room list on close so a reopened dialog never trusts a
          // stale one; the effect above re-checks as soon as it is open again.
          if (!next) setFreeRooms(null);
        }}
      >
        <DialogTrigger render={trigger} />
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New walk-in booking</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormInput
              control={form.control}
              name="guest_name"
              label="Guest name"
              placeholder="Juan dela Cruz"
            />
            <div className="grid grid-cols-2 gap-3">
              <FormInput
                control={form.control}
                name="guest_phone"
                label="Phone"
                placeholder="09xx…"
              />
              <FormInput
                control={form.control}
                name="guest_email"
                label="Email"
                placeholder="optional"
              />
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
                label={selectedType ? `Guests (max ${selectedType.max_occupancy})` : "Guests"}
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
              // A date, not a datetime: an overnight guest is due out at noon,
              // so offering an hour would be offering a choice that isn't one.
              <FormInput
                control={form.control}
                name="check_out"
                label="Check-out (12:00 noon)"
                type="date"
                min={nightAfter(checkIn)}
              />
            ) : null}
            <FormSelect
              control={form.control}
              name="room_id"
              label="Room"
              options={roomOptions}
              placeholder={ANY_ROOM_LABEL}
              disabled={!selectedType || !freeRooms || freeRooms.length === 0}
              description={
                chosenRoomGone
                  ? "That room was taken while you were typing — it's back to any free room."
                  : "Leave on “any free room” unless the guest asked for a particular one."
              }
            />
            <FormTextarea control={form.control} name="notes" label="Notes" rows={2} />

            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Wallet className="text-muted-foreground size-4" />
                Payment
                <span className="text-muted-foreground text-xs font-normal">
                  collected in full now
                </span>
              </div>
              {/* No amount field on purpose: a walk-in settles the whole price at
                the desk, so the action records the booking's own quoted_total —
                part payments and overpayments aren't possible here. */}
              <div className="bg-muted/50 flex items-baseline justify-between rounded-md px-3 py-2">
                <span className="text-muted-foreground text-xs">Amount to collect</span>
                <span className="text-base font-semibold tabular-nums">
                  {totalDue != null ? peso.format(totalDue) : "—"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormSelect
                  control={form.control}
                  name="payment_method"
                  label="Method"
                  options={methodOptions}
                />
                <FormInput
                  control={form.control}
                  name="payment_reference"
                  label="Reference (optional)"
                  placeholder="OR / txn no."
                />
              </div>
            </div>

            <SummaryPanel
              checking={checking}
              available={available}
              // Shown for both kinds now: the block derives its end from the
              // duration, the overnight from the house noon, and in each case
              // it is the time the clerk tells the guest.
              derivedCheckout={effectiveCheckOut ? dtFmt.format(effectiveCheckOut) : null}
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
                {pending ? "Booking…" : "Confirm booking & payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Sibling, not nested: the form dialog has already closed by the time
        this opens, and stacking two modals would trap focus in the wrong one. */}
      <BookingConfirmedDialog
        booking={confirmed?.booking ?? null}
        paid={confirmed?.paid ?? 0}
        onOpenChange={(next) => {
          if (!next) setConfirmed(null);
        }}
      />
    </>
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
