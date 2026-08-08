"use client";

import { CheckCircle2, DoorOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { peso } from "@/features/bookings/pricing";
import type { BookingRow } from "@/features/bookings/repository";

const dt = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
function fmt(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dt.format(d);
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * Shown the moment a booking becomes the guest's to walk into — a walk-in taken
 * at the counter, or an online booking whose deposit staff just verified. Both
 * end with a clerk who has to say a room number out loud, so the room is the
 * headline and everything else supports it.
 *
 * It is deliberately a modal rather than a toast: a toast disappears on its own
 * timer, and the clerk may still be counting change when it does.
 */
export function BookingConfirmedDialog({
  booking,
  paid,
  onOpenChange,
}: {
  /** Null closes the dialog — the caller sets it to open. */
  booking: BookingRow | null;
  paid: number;
  onOpenChange: (open: boolean) => void;
}) {
  const balance = booking ? Number(booking.quoted_total) - paid : 0;

  return (
    <Dialog open={!!booking} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        {booking ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-600" />
                Booking confirmed
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              {/* The one thing the guest is waiting to hear. */}
              <div className="border-border/60 bg-muted/40 flex flex-col items-center gap-1 rounded-xl border p-5 text-center">
                <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase">
                  <DoorOpen className="size-3.5" /> Room
                </span>
                <span className="text-4xl leading-none font-bold tabular-nums">
                  {booking.room?.label ?? "—"}
                </span>
                {booking.room_type?.name ? (
                  <span className="text-muted-foreground text-sm">{booking.room_type.name}</span>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Line
                  label="Reference"
                  value={<span className="font-mono">{booking.reference_code}</span>}
                />
                <Line label="Guest" value={booking.guest_name} />
                <Line label="Check-in" value={fmt(booking.checkIn)} />
                <Line label="Check-out" value={fmt(booking.checkOut)} />
                <Line label="Rate" value={booking.rate_tier?.label ?? "—"} />
                <Line
                  label="Guests"
                  value={`${booking.guest_count} guest${booking.guest_count === 1 ? "" : "s"}`}
                />
              </div>

              <div className="border-border/60 flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-muted-foreground text-xs">Total</span>
                  <span className="font-medium tabular-nums">
                    {peso.format(Number(booking.quoted_total))}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-muted-foreground text-xs">Paid</span>
                  <span className="font-medium tabular-nums">{peso.format(paid)}</span>
                </div>
                {/* Only when there's something to collect — a walk-in settles in
                    full, so a ₱0.00 balance line would be noise on that path. */}
                {balance > 0 ? (
                  <div className="flex items-baseline justify-between border-t pt-1.5">
                    <span className="text-xs font-medium">Balance on arrival</span>
                    <span className="text-base font-semibold tabular-nums">
                      {peso.format(balance)}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            <DialogFooter>
              <DialogClose render={<Button>Done</Button>} />
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
