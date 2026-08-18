"use client";

import { useTransition } from "react";
import { CheckCircle2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { checkIn } from "@/features/bookings/front-desk-actions";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { peso } from "@/features/bookings/pricing";
import { RoomNumberBox } from "./room-number-box";
import type { ConfirmedBooking } from "@/features/bookings/schemas";
import { innFormatter, innSameDay } from "@/lib/inn-time";

const dt = innFormatter({
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

/**
 * What the confirm step says before handing over a room.
 *
 * This panel is reached two ways — a walk-in just taken at the counter, and an
 * online booking whose deposit staff just verified — and the SAME walk-in
 * dialog is also how advance bookings get entered (the availability page hands
 * it a searched future window). So the arrival is spelled out every time, and
 * a booking that isn't for today says so plainly: checking in a guest who
 * arrives on Saturday marks the room occupied from now until they leave.
 */
function checkInWarning(booking: ConfirmedBooking): string {
  const arrival = fmt(booking.checkIn);
  const room = booking.room?.label ? `room ${booking.room.label}` : "the room";
  const arrivesToday = booking.checkIn ? innSameDay(new Date(booking.checkIn), new Date()) : false;
  const base = `${booking.guest_name} takes ${room} now, and it is marked occupied.`;
  return arrivesToday
    ? `${base} Booked arrival is ${arrival}.`
    : `${base} NOTE: this booking is for ${arrival}, not today — check in only if the guest is here.`;
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
  /** Null closes the dialog — the caller sets it to open. A full `BookingRow`
   *  satisfies this too, which is how the manage dialog still passes its own. */
  booking: ConfirmedBooking | null;
  paid: number;
  onOpenChange: (open: boolean) => void;
  // There is deliberately no onCheckedIn callback. Both callers used it to
  // router.refresh(), and `checkIn` already revalidates /bookings, /calendar
  // and /dashboard — Next re-renders the current page inside the action's own
  // response, so the list behind this panel is fresh before it closes. Leaving
  // the hook here only invited a second, identical page fetch to be wired back
  // in.
}) {
  const [pending, startTransition] = useTransition();
  const balance = booking ? Number(booking.quoted_total) - paid : 0;

  function handleCheckIn() {
    if (!booking) return;
    startTransition(async () => {
      const result = await checkIn(booking.id);
      if (result.ok) {
        toast.success(
          `Checked in — ${booking.guest_name} has ${
            booking.room?.label ? `room ${booking.room.label}` : "their room"
          }.`
        );
        onOpenChange(false);
      } else {
        // The booking is untouched and still confirmed, so the panel stays open
        // and the clerk can try again or use the manage dialog.
        toast.error(result.error);
      }
    });
  }

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
              <RoomNumberBox
                label={booking.room?.label ?? null}
                typeName={booking.room_type?.name ?? null}
              />

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
              {/* The guest is usually standing right there, so checking in is
                  one tap from here instead of a second trip through the manage
                  dialog. Confirmed first, because it is not a preview: it hands
                  the room over and marks it occupied. */}
              <ConfirmDialog
                title="Check in now?"
                description={checkInWarning(booking)}
                confirmLabel="Check in"
                onConfirm={handleCheckIn}
                trigger={
                  <Button disabled={pending}>
                    <LogIn className="size-4" /> Check In Now
                  </Button>
                }
              />
              {/* Not "Done": the booking exists either way, and the real choice
                  on this panel is WHEN the guest is let into the room. */}
              <DialogClose
                render={
                  <Button variant="outline" disabled={pending}>
                    Check In Later
                  </Button>
                }
              />
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
