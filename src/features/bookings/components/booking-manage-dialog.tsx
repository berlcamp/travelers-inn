"use client";

import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, Ban, UserX } from "lucide-react";
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
import {
  loadBookingDetail,
  checkIn,
  checkOut,
  markNoShow,
} from "@/features/bookings/front-desk-actions";
import { cancelBooking } from "@/features/bookings/actions";
import { peso } from "@/features/bookings/pricing";
import { type BookingStatus } from "@/features/bookings/schemas";
import { PAYMENT_METHOD_LABELS } from "@/features/bookings/payment-schema";
import type { BookingDetail } from "@/features/bookings/repository";

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

export function BookingManageDialog({
  bookingId,
  trigger,
}: {
  bookingId: string;
  trigger: React.ReactElement<Record<string, unknown>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<BookingDetail | null>(null);
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

  function refresh() {
    void load();
    router.refresh();
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

  return (
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
            {/* Summary */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Field label="Reference" value={<span className="font-mono text-xs">{b.reference_code}</span>} />
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

            {/* Assigned room (reassignable when active) */}
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Assigned room</span>
              {detail.availableRooms.length > 0 &&
              (status === "confirmed" || status === "checked_in") ? (
                <ReassignRoomSelect
                  bookingId={b.id}
                  currentRoomId={b.room_id}
                  rooms={detail.availableRooms}
                  onDone={refresh}
                />
              ) : (
                <span className="font-medium">Room {b.room?.label ?? "—"}</span>
              )}
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              {status === "confirmed" ? (
                <Button size="sm" disabled={pending} onClick={() => runAction(() => checkIn(b.id), "Checked in.")}>
                  <LogIn className="size-4" /> Check in
                </Button>
              ) : null}
              {status === "checked_in" ? (
                <Button size="sm" disabled={pending} onClick={() => runAction(() => checkOut(b.id), "Checked out.")}>
                  <LogOut className="size-4" /> Check out
                </Button>
              ) : null}
              {status === "confirmed" ? (
                <ConfirmDialog
                  title="Mark as no-show?"
                  description={`${b.guest_name} did not arrive. This frees room ${b.room?.label ?? ""}.`}
                  confirmLabel="Mark no-show"
                  onConfirm={() => runAction(() => markNoShow(b.id), "Marked no-show.")}
                  trigger={
                    <Button size="sm" variant="outline" disabled={pending}>
                      <UserX className="size-4" /> No-show
                    </Button>
                  }
                />
              ) : null}
              {status === "confirmed" || status === "checked_in" ? (
                <ConfirmDialog
                  title="Cancel this booking?"
                  description={`This frees room ${b.room?.label ?? ""} and cannot be undone.`}
                  confirmLabel="Cancel booking"
                  onConfirm={() => runAction(() => cancelBooking(b.id), "Booking cancelled.")}
                  trigger={
                    <Button size="sm" variant="outline" disabled={pending}>
                      <Ban className="size-4" /> Cancel
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
                <ul className="flex flex-col gap-1 text-xs">
                  {detail.payments.map((p) => (
                    <li key={p.id} className="text-muted-foreground flex justify-between">
                      <span>
                        {PAYMENT_METHOD_LABELS[p.method]}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </span>
                      <span className="tabular-nums">{peso.format(Number(p.amount))}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {balance > 0 && status !== "cancelled" && status !== "no_show" ? (
                <RecordPaymentForm bookingId={b.id} balance={balance} onDone={refresh} />
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
