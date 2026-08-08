import { Badge } from "@/components/ui/badge";
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type BookingStatus,
} from "@/features/bookings/schemas";

/**
 * One hue per status, because the bookings list is read by scanning a column of
 * these: `confirmed` and `checked_in` used to share the solid primary and
 * `pending_verification` shared grey with `checked_out`, so half the column was
 * two colours for four meanings.
 *
 * The hues follow what the front desk has to DO, not the alphabet: amber wants
 * attention now, blue is settled and upcoming, emerald is in the building,
 * slate is finished, red is money that never arrived. `cancelled` is the one
 * that isn't a fill at all — an outline reads as absence, and it also keeps the
 * two "didn't happen" states apart by shape rather than by two similar reds,
 * which is what a colour-blind clerk actually has to go on.
 */
const STATUS_CLASS: Record<BookingStatus, string> = {
  pending_verification: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  confirmed: "border-blue-500/30 bg-blue-500/15 text-blue-700 dark:text-blue-300",
  checked_in: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  checked_out: "border-slate-500/30 bg-slate-500/15 text-slate-700 dark:text-slate-300",
  cancelled: "border-border bg-transparent text-muted-foreground",
  no_show: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return (
    <Badge variant="outline" className={STATUS_CLASS[status]}>
      {BOOKING_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Payment sits in the next column along, so it deliberately avoids blue: a
 * blue "Paid" beside a blue "Confirmed" is two different facts wearing the
 * same colour. Money reads red → amber → green, which is the one colour
 * sequence people already know.
 */
const PAYMENT_CLASS: Record<"unpaid" | "partial" | "paid", string> = {
  unpaid: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
  partial: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  paid: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

export function PaymentStatusBadge({ status }: { status: "unpaid" | "partial" | "paid" }) {
  return (
    <Badge variant="outline" className={PAYMENT_CLASS[status]}>
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}
