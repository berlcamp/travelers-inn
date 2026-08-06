import { peso } from "@/features/bookings/pricing";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/features/bookings/payment-schema";
import { BOOKING_STATUS_LABELS, type BookingStatus } from "@/features/bookings/schemas";
import { BOOKING_SOURCE_LABELS } from "@/features/bookings/trail";
import { BookingStatusBadge } from "@/features/bookings/components/booking-status-badge";
import type { ReportBooking, ReportPayment } from "@/features/reports/analytics";

const dt = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dt.format(d);
};

// Both ledgers render every row rather than paginating: these are the sheets an
// owner prints or reconciles against a cash drawer, and a page-2 that never
// prints is worse than a long page. They scroll on screen, in full on paper.
// No border of its own: the ledger sits flush inside its SectionCard, which
// already draws the surface. A bordered table inside a bordered card reads as
// two panels.
const WRAP = "max-h-[28rem] overflow-auto print:max-h-none print:overflow-visible";
const HEAD =
  "bg-muted/40 border-border/60 text-muted-foreground sticky top-0 border-b text-xs font-semibold tracking-wider uppercase";

export function PaymentsLedger({ payments }: { payments: ReportPayment[] }) {
  if (payments.length === 0) {
    return (
      <p className="text-muted-foreground px-4 pt-4 text-sm">No payments received in this range.</p>
    );
  }
  const total = payments.reduce((acc, p) => acc + p.amount, 0);

  return (
    <div className={WRAP}>
      <table className="w-full text-sm">
        <thead className={HEAD}>
          <tr>
            <th className="px-4 py-2 text-left font-semibold">Received</th>
            <th className="px-4 py-2 text-left font-semibold">Guest</th>
            <th className="px-4 py-2 text-left font-semibold">Method</th>
            <th className="px-4 py-2 text-left font-semibold">Received by</th>
            <th className="px-4 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-border/60 border-t">
              <td className="text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                {fmt(p.createdAt)}
              </td>
              <td className="px-4 py-2.5">
                <span className="font-medium">{p.guestName}</span>
                <span className="text-muted-foreground font-mono text-xs"> · {p.bookingRef}</span>
              </td>
              <td className="px-4 py-2.5">
                {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                {p.reference ? (
                  <span className="text-muted-foreground text-xs"> · {p.reference}</span>
                ) : null}
              </td>
              <td className="px-4 py-2.5">{p.recordedByName ?? "—"}</td>
              <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                {peso.format(p.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 border-t font-medium">
            <td className="px-4 py-2.5" colSpan={4}>
              Total collected
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums">{peso.format(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function BookingsLedger({ bookings }: { bookings: ReportBooking[] }) {
  if (bookings.length === 0) {
    return (
      <p className="text-muted-foreground px-4 pt-4 text-sm">No bookings taken in this range.</p>
    );
  }

  return (
    <div className={WRAP}>
      <table className="w-full text-sm">
        <thead className={HEAD}>
          <tr>
            <th className="px-4 py-2 text-left font-semibold">Booked on</th>
            <th className="px-4 py-2 text-left font-semibold">Guest</th>
            <th className="px-4 py-2 text-left font-semibold">Stay</th>
            <th className="px-4 py-2 text-left font-semibold">Status</th>
            <th className="px-4 py-2 text-left font-semibold">Handled by</th>
            <th className="px-4 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id} className="border-border/60 border-t">
              <td className="text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                {fmt(b.createdAt)}
              </td>
              <td className="px-4 py-2.5">
                <span className="font-medium">{b.guestName}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {" "}
                  · {b.referenceCode}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span className="whitespace-nowrap">
                  {fmt(b.checkIn)} → {fmt(b.checkOut)}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {b.roomLabel ? `Room ${b.roomLabel}` : "—"}
                  {b.roomTypeName ? ` · ${b.roomTypeName}` : ""}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <BookingStatusBadge status={b.status as BookingStatus} />
              </td>
              <td className="px-4 py-2.5">
                {b.createdByName ?? (b.source === "portal" ? "Guest (online)" : "—")}
                <span className="text-muted-foreground block text-xs">
                  {BOOKING_SOURCE_LABELS[b.source] ?? b.source}
                  {b.verifiedByName ? ` · verified by ${b.verifiedByName}` : ""}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                {peso.format(b.quotedTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const STATUS_LABEL = (key: string) => BOOKING_STATUS_LABELS[key as BookingStatus] ?? key;
export const SOURCE_LABEL = (key: string) => BOOKING_SOURCE_LABELS[key] ?? key;
export const METHOD_LABEL = (key: string) => PAYMENT_METHOD_LABELS[key as PaymentMethod] ?? key;
