import { Badge } from "@/components/ui/badge";
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type BookingStatus,
} from "@/features/bookings/schemas";

const STATUS_VARIANT: Record<BookingStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  pending_verification: "secondary",
  confirmed: "default",
  checked_in: "default",
  checked_out: "secondary",
  cancelled: "outline",
  no_show: "destructive",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return (
    <Badge
      variant={STATUS_VARIANT[status]}
      className={
        status === "pending_verification"
          ? "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300"
          : undefined
      }
    >
      {BOOKING_STATUS_LABELS[status]}
    </Badge>
  );
}

const PAYMENT_VARIANT: Record<
  "unpaid" | "partial" | "paid",
  React.ComponentProps<typeof Badge>["variant"]
> = {
  unpaid: "destructive",
  partial: "secondary",
  paid: "default",
};

export function PaymentStatusBadge({ status }: { status: "unpaid" | "partial" | "paid" }) {
  return <Badge variant={PAYMENT_VARIANT[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}
