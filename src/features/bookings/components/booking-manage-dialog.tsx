"use client";

import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { LogIn, LogOut, Ban, UserX, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { BookingStatusBadge, PaymentStatusBadge } from "./booking-status-badge";
import { RecordPaymentForm } from "./record-payment-form";
import { ReassignRoomSelect } from "./reassign-room-select";
import { VerificationPanel } from "./verification-panel";
import { ActivityTrail } from "./activity-trail";
import { BOOKING_SOURCE_LABELS } from "@/features/bookings/trail";
import { loadBookingDetail } from "@/features/bookings/front-desk-actions";
import { deleteBooking } from "@/features/bookings/actions";
import { applyTransition } from "@/features/bookings/apply-transition";
import {
  allowedTransitions,
  transitionDescription,
  type TransitionTarget,
} from "@/features/bookings/booking-transitions";
import { peso } from "@/features/bookings/pricing";
import { type BookingStatus } from "@/features/bookings/schemas";
import { PAYMENT_METHOD_LABELS } from "@/features/bookings/payment-schema";
import { BookingConfirmedDialog } from "./booking-confirmed-dialog";
import { RoomNumberBox } from "./room-number-box";
import type { BookingDetail, BookingRow } from "@/features/bookings/repository";
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

const TRANSITION_ICON: Record<TransitionTarget, React.ComponentType<{ className?: string }>> = {
  checked_in: LogIn,
  checked_out: LogOut,
  no_show: UserX,
  cancelled: Ban,
};

export function BookingManageDialog({
  bookingId,
  trigger,
  canDelete = false,
}: {
  bookingId: string;
  trigger: React.ReactElement<Record<string, unknown>>;
  // Deleting is an administrator's correction, not a front-desk operation, so
  // the button is absent rather than disabled for everyone else — a disabled
  // control still says "this is a thing you nearly do here". Defaults to false:
  // the caller has to have asked. The real refusal is the RLS policy on
  // bookings (migration 20260817000100) and requireRole in the action; this
  // prop only decides whether the button is drawn.
  canDelete?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [confirmed, setConfirmed] = useState<{ booking: BookingRow; paid: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    const result = await loadBookingDetail(bookingId);
    setDetail(result.ok ? result.data : null);
    setLoading(false);
    if (!result.ok) toast.error(result.error);
  }, [bookingId]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
  }

  // Only the dialog's OWN detail is re-read. The list, calendar and dashboard
  // behind it are already fresh: every action here calls revalidatePath for
  // those routes, and Next re-renders the current page inside the action's own
  // response. A router.refresh() on top fetched the same page a second time —
  // measured as a second full render plus another proxy auth round trip.
  function refresh() {
    void load();
  }

  // Verifying a deposit is the moment an online booking becomes the guest's to
  // walk into, so it ends the same way a walk-in does: this dialog steps aside
  // and the room panel takes over. Re-reading first is what makes the panel
  // show the CONFIRMED row rather than the pending_verification one it was
  // opened with.
  async function onVerified() {
    const result = await loadBookingDetail(bookingId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDetail(result.data);
    setOpen(false);
    setConfirmed({ booking: result.data.booking, paid: result.data.paid });
  }

  // Deleting can't go through runAction: that one re-reads the detail on
  // success, and there is no detail left to read. Re-reading a deleted booking
  // answers "Booking not found" and would toast an error directly on top of
  // the success. So this just closes the dialog — deleteBooking revalidates
  // /bookings, so the list behind it is already redrawn without the row.
  function onDelete(id: string) {
    startTransition(async () => {
      const result = await deleteBooking(id);
      if (result.ok) {
        setOpen(false);
        setDetail(null);
        toast.success(`Booking ${result.data.reference_code} deleted.`);
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  function runAction(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(okMsg);
        refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  const b = detail?.booking;
  const status = b?.status as BookingStatus | undefined;
  const balance = detail ? Number(b!.quoted_total) - detail.paid : 0;
  // The room is only a place the guest walks into while the stay is live. Once
  // it's checked out, cancelled or a no-show the room has been freed, so a
  // headline room number would be telling the clerk something untrue.
  const stayIsLive =
    status === "pending_verification" || status === "confirmed" || status === "checked_in";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger render={trigger} />
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {b ? b.guest_name : "Booking"}
              {status ? <BookingStatusBadge status={status} /> : null}
            </DialogTitle>
          </DialogHeader>

          {loading && !detail ? (
            <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>
          ) : !detail || !b ? (
            <p className="text-muted-foreground py-8 text-center text-sm">Booking not found.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {/* The number the clerk reads out loud, so it leads the dialog.
                The reassign select sits directly under it and refreshes this
                detail on success, which is what makes the box redraw the
                moment a guest is moved — the two can never disagree. */}
              {stayIsLive ? (
                <div className="flex flex-col gap-2">
                  <RoomNumberBox label={b.room?.label ?? null} />
                  {detail.availableRooms.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground text-xs">Change room</span>
                      <ReassignRoomSelect
                        bookingId={b.id}
                        currentRoomId={b.room_id}
                        rooms={detail.availableRooms}
                        onDone={refresh}
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">Assigned room</span>
                  <span className="font-medium">Room {b.room?.label ?? "—"}</span>
                </div>
              )}

              {/* Summary */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field
                  label="Reference"
                  value={<span className="font-mono text-xs">{b.reference_code}</span>}
                />
                <Field label="Room type" value={b.room_type?.name ?? "—"} />
                <Field label="Check-in" value={fmt(b.checkIn)} />
                <Field label="Check-out" value={fmt(b.checkOut)} />
                <Field label="Rate" value={b.rate_tier?.label ?? "—"} />
                <Field
                  label="Guests"
                  value={`${b.guest_count} guest${b.guest_count === 1 ? "" : "s"}`}
                />
                <Field label="Contact" value={b.guest_phone || b.guest_email || "—"} />
              </div>

              {/* Staff attribution. A portal booking has no creator — the guest
                made it — so "Booked by" names the channel instead, and the
                verifier is the staff member who checked the deposit. A walk-in
                is confirmed the moment it's taken, by whoever took it. */}
              <div className="bg-muted/40 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg p-3 text-sm">
                <Field
                  label={`Booked by · ${BOOKING_SOURCE_LABELS[b.source] ?? b.source}`}
                  value={b.createdByName ?? (b.source === "portal" ? "Guest (online)" : "—")}
                />
                <Field label="Taken on" value={fmt(b.created_at)} />
                {b.verifiedByName || b.verified_at ? (
                  <>
                    <Field label="Deposit verified by" value={b.verifiedByName ?? "—"} />
                    <Field label="Verified on" value={b.verified_at ? fmt(b.verified_at) : "—"} />
                  </>
                ) : null}
              </div>

              {status === "pending_verification" ? (
                <VerificationPanel
                  bookingId={b.id}
                  proof={detail.proof}
                  onDone={refresh}
                  onConfirmed={() => void onVerified()}
                />
              ) : null}

              {/* Lifecycle actions */}
              <div className="flex flex-wrap gap-2">
                {/* The same moves, in the same order, with the same wording as
                    the status dropdown on the /bookings list — both render
                    `allowedTransitions` (features/bookings/booking-transitions.ts).
                    Two surfaces that disagree about which moves exist, or about
                    what a move costs, is worse than either being wrong on its
                    own: staff learn one and are caught out by the other.

                    Every one of them moves the booking somewhere this dialog
                    cannot move it back from, and they sit side by side one tap
                    apart — so each asks first. */}
                {allowedTransitions(status ?? "").map((t) => {
                  const Icon = TRANSITION_ICON[t.to];
                  return (
                    <ConfirmDialog
                      key={t.to}
                      title={t.title}
                      description={transitionDescription(t.to, {
                        guestName: b.guest_name,
                        roomLabel: b.room?.label ?? "",
                        checkInText: fmt(b.checkIn),
                        checkOutText: fmt(b.checkOut),
                      })}
                      confirmLabel={t.confirmLabel}
                      onConfirm={() => runAction(() => applyTransition(t.to, b.id), t.success)}
                      trigger={
                        <Button
                          size="sm"
                          variant={t.destructive ? "outline" : "default"}
                          disabled={pending}
                        >
                          <Icon className="size-4" /> {t.label}
                        </Button>
                      }
                    />
                  );
                })}

                {/* Administrator only, and pushed to the far end away from the
                  day-to-day buttons: this is a correction to the record, not a
                  step in a stay. The description spells out the money because
                  deleting takes it out of every report retrospectively — a
                  cancellation at least leaves a row that explains itself. */}
                {canDelete ? (
                  <ConfirmDialog
                    title="Delete this booking permanently?"
                    description={
                      `${b.guest_name} · ${b.reference_code} will be erased` +
                      (detail.payments.length > 0
                        ? `, along with ${detail.payments.length} payment${
                            detail.payments.length === 1 ? "" : "s"
                          } totalling ${peso.format(detail.paid)}`
                        : "") +
                      ". It leaves every report retrospectively and cannot be brought back — " +
                      "cancel it instead if the booking happened and fell through."
                    }
                    confirmLabel="Delete permanently"
                    onConfirm={() => onDelete(b.id)}
                    trigger={
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={pending}
                        className="ml-auto"
                      >
                        <Trash2 className="size-4" /> Delete
                      </Button>
                    }
                  />
                ) : null}
              </div>

              <Separator />

              {/* Payment */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Payment</span>
                  <PaymentStatusBadge status={b.payment_status as "unpaid" | "partial" | "paid"} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <Field label="Total" value={peso.format(Number(b.quoted_total))} />
                  <Field label="Paid" value={peso.format(detail.paid)} />
                  <Field label="Balance" value={peso.format(Math.max(0, balance))} />
                </div>

                {detail.payments.length > 0 ? (
                  <ul className="flex flex-col gap-1.5 text-xs">
                    {detail.payments.map((p) => (
                      <li key={p.id} className="flex justify-between gap-3">
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium">
                            {PAYMENT_METHOD_LABELS[p.method]}
                            {p.reference ? (
                              <span className="text-muted-foreground"> · {p.reference}</span>
                            ) : null}
                          </span>
                          <span className="text-muted-foreground">
                            Received by {p.recordedByName ?? "—"} · {fmt(p.created_at)}
                          </span>
                        </span>
                        <span className="font-medium tabular-nums">
                          {peso.format(Number(p.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {balance > 0 &&
                status !== "cancelled" &&
                status !== "no_show" &&
                status !== "pending_verification" ? (
                  <RecordPaymentForm bookingId={b.id} balance={balance} onDone={refresh} />
                ) : null}
              </div>

              <Separator />

              {/* Activity trail */}
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Activity</span>
                <ActivityTrail entries={detail.trail} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Sibling, not nested: this dialog closes as the room panel opens, so the
        two never stack and focus lands where the clerk is looking. */}
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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
