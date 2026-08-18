"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ban, ChevronDown, LogIn, LogOut, UserX } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { BookingStatusBadge } from "./booking-status-badge";
import { applyTransition } from "@/features/bookings/apply-transition";
import {
  allowedTransitions,
  transitionDescription,
  type BookingTransition,
  type TransitionTarget,
} from "@/features/bookings/booking-transitions";
import { BOOKING_STATUS_LABELS, type BookingStatus } from "@/features/bookings/schemas";
import type { BookingRow } from "@/features/bookings/repository";
import { innFormatter } from "@/lib/inn-time";

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

const ICON: Record<TransitionTarget, React.ComponentType<{ className?: string }>> = {
  checked_in: LogIn,
  checked_out: LogOut,
  no_show: UserX,
  cancelled: Ban,
};

/**
 * The Status cell on /bookings: the badge staff already read, now also the
 * control that moves the booking on.
 *
 * The common case is a guest at the counter and a clerk who can see the right
 * row — making them open the manage dialog to press one button was a modal and
 * a round trip for a decision they had already made. So the moves come to the
 * row.
 *
 * It is deliberately NOT a free choice of all six statuses. The menu offers
 * only what the server will accept from here (`allowedTransitions`), because
 * every one of these is a real operation with side effects — the room going to
 * occupied or cleaning, the real departure time stamped over the booked window
 * — not a column being overwritten. A booking with no moves keeps the plain
 * badge it has always had: a finished stay has nothing after it, and a booking
 * awaiting deposit verification is confirmed or rejected in the manage
 * dialog's verification panel, which needs the amount and the reason a menu
 * cannot ask for.
 *
 * Every move still asks first, in the same modal the manage dialog uses, with
 * the same words — these are one tap apart in a list of dozens of rows, and
 * none of them can be taken back from here.
 */
export function BookingStatusSelect({ booking }: { booking: BookingRow }) {
  const [chosen, setChosen] = useState<BookingTransition | null>(null);

  const status = booking.status as BookingStatus;
  const moves = allowedTransitions(status);

  if (moves.length === 0) return <BookingStatusBadge status={status} />;

  const context = {
    guestName: booking.guest_name,
    roomLabel: booking.room?.label ?? "",
    checkInText: fmt(booking.checkIn),
    checkOutText: fmt(booking.checkOut),
  };

  // ConfirmDialog keeps itself open with both buttons disabled until this
  // settles, so the clerk can't fire the same transition twice. A refusal
  // (someone else moved the booking first) is toasted and the row keeps the
  // status it already had — nothing on screen has claimed otherwise.
  //
  // No router.refresh(): every one of these actions calls
  // revalidatePath("/bookings"), and Next re-renders the page inside the
  // action's own response. Refreshing as well would fetch the identical list a
  // second time and pay the proxy's auth round trip again for it.
  async function run(transition: BookingTransition) {
    const result = await applyTransition(transition.to, booking.id);
    if (result.ok) {
      toast.success(transition.success);
    } else {
      toast.error(result.error ?? "Something went wrong.");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="focus-visible:ring-ring/50 -m-1 flex cursor-pointer items-center gap-1 rounded-md p-1 outline-none focus-visible:ring-2"
              aria-label={`${BOOKING_STATUS_LABELS[status]} — change status`}
            >
              <BookingStatusBadge status={status} />
              <ChevronDown className="text-muted-foreground size-3.5" />
            </button>
          }
        />
        {/* `w-auto` overrides the shared popup's `w-(--anchor-width)`, which
          pins the menu to the width of whatever opened it. That is right for a
          select sitting on a full-width field; here the trigger is a badge a
          few characters wide, so "Cancel booking" wrapped onto two lines. The
          menu sizes to its longest label instead, and `whitespace-nowrap`
          keeps it there. The inherited `min-w-32` floor still applies. */}
        <DropdownMenuContent align="start" className="w-auto whitespace-nowrap">
          {moves.map((transition) => {
            const Icon = ICON[transition.to];
            return (
              <DropdownMenuItem
                key={transition.to}
                variant={transition.destructive ? "destructive" : "default"}
                onClick={() => setChosen(transition)}
              >
                <Icon className="size-4" /> {transition.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sibling of the menu, not a child of a menu item: the menu unmounts its
        content the moment it dismisses, which is exactly when this has to
        appear. Same reason the room-types table renders its edit dialog out
        here. */}
      <ConfirmDialog
        open={chosen !== null}
        onOpenChange={(next) => {
          if (!next) setChosen(null);
        }}
        title={chosen?.title ?? ""}
        description={chosen ? transitionDescription(chosen.to, context) : ""}
        confirmLabel={chosen?.confirmLabel ?? "Confirm"}
        onConfirm={() => (chosen ? run(chosen) : undefined)}
      />
    </>
  );
}
