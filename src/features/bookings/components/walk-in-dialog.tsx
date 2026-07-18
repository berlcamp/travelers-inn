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
import { quote, peso } from "@/features/bookings/pricing";
import type { RoomType } from "@/features/rooms/repository";

// "YYYY-MM-DDTHH:mm" in local wall-clock, for datetime-local inputs.
function localDateTime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaults(): BookingFormValues {
  const checkIn = new Date();
  checkIn.setHours(14, 0, 0, 0);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 1);
  checkOut.setHours(12, 0, 0, 0);
  return {
    guest_name: "",
    guest_phone: "",
    guest_email: "",
    room_type_id: "",
    stay_type: "nightly",
    check_in: localDateTime(checkIn),
    check_out: localDateTime(checkOut),
    notes: "",
  };
}

export function WalkInDialog({
  trigger,
  roomTypes,
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
  roomTypes: RoomType[];
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
  const stayOptions = [
    { value: "nightly", label: "Nightly" },
    { value: "hourly", label: "Hourly" },
  ];

  const [roomTypeId, stayType, checkIn, checkOut] = useWatch({
    control: form.control,
    name: ["room_type_id", "stay_type", "check_in", "check_out"],
  });

  const selectedType = roomTypes.find((t) => t.id === roomTypeId) ?? null;

  const priceQuote = useMemo(() => {
    if (!selectedType || !checkIn || !checkOut) return null;
    return quote(
      stayType as "nightly" | "hourly",
      new Date(checkIn),
      new Date(checkOut),
      Number(selectedType.nightly_rate),
      selectedType.hourly_rate != null ? Number(selectedType.hourly_rate) : null
    );
  }, [selectedType, stayType, checkIn, checkOut]);

  // Debounced availability check whenever type/dates change.
  useEffect(() => {
    if (!roomTypeId || !checkIn || !checkOut) {
      setAvailable(null);
      return;
    }
    setChecking(true);
    const handle = setTimeout(async () => {
      const result = await checkAvailability(roomTypeId, checkIn, checkOut);
      setAvailable(result.ok ? result.data.count : 0);
      setChecking(false);
    }, 350);
    return () => clearTimeout(handle);
  }, [roomTypeId, checkIn, checkOut]);

  const priceError = priceQuote && "error" in priceQuote ? priceQuote.error : null;
  const canSubmit = !pending && available != null && available > 0 && !priceError;

  function onSubmit(values: BookingInput) {
    startTransition(async () => {
      const result = await createBooking(values);
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
      <DialogContent className="sm:max-w-lg">
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
            <FormSelect control={form.control} name="stay_type" label="Stay type" options={stayOptions} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormInput control={form.control} name="check_in" label="Check-in" type="datetime-local" />
            <FormInput control={form.control} name="check_out" label="Check-out" type="datetime-local" />
          </div>
          <FormTextarea control={form.control} name="notes" label="Notes" rows={2} />

          <SummaryPanel
            checking={checking}
            available={available}
            priceLine={
              priceError
                ? priceError
                : priceQuote && "total" in priceQuote
                  ? `${priceQuote.units} ${priceQuote.unitLabel} · ${peso.format(priceQuote.total)}`
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

function SummaryPanel({
  checking,
  available,
  priceLine,
  priceError,
}: {
  checking: boolean;
  available: number | null;
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
          <span className="text-muted-foreground">Pick a room type and dates.</span>
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
      {priceLine ? (
        <div className={priceError ? "text-destructive" : "font-medium"}>{priceLine}</div>
      ) : null}
    </div>
  );
}
