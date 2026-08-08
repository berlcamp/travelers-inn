import { peso } from "@/features/bookings/pricing";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/features/bookings/payment-schema";
import { BOOKING_SOURCE_LABELS } from "@/features/bookings/trail";
import { isCashMethod } from "@/features/reports/analytics";
import type { CollectionRow } from "@/features/collections/repository";

const dt = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const timeOnly = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" });

// Every row, never paginated: this is the sheet counted against a drawer, and a
// page 2 that never prints would hide money. It scrolls on screen and prints in
// full — hence the print overrides on the wrapper.
const WRAP = "max-h-[32rem] overflow-auto print:max-h-none print:overflow-visible";
const HEAD =
  "bg-muted/40 border-border/60 text-muted-foreground sticky top-0 border-b text-xs font-semibold tracking-wider uppercase print:static";

export function CollectionsLedger({
  payments,
  showStaff,
  singleDay,
}: {
  payments: CollectionRow[];
  /** Off when the sheet is already one person's — the column would repeat the
   *  same name down the page and steal width from the guest. */
  showStaff: boolean;
  /** A one-day sheet needs the clock, not the date. */
  singleDay: boolean;
}) {
  if (payments.length === 0) {
    return (
      <p className="text-muted-foreground px-4 pt-4 text-sm">
        No collections in this range. Nothing to remit.
      </p>
    );
  }

  const cash = payments.filter((p) => isCashMethod(p.method)).reduce((a, p) => a + p.amount, 0);
  const total = payments.reduce((a, p) => a + p.amount, 0);
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return singleDay ? timeOnly.format(d) : dt.format(d);
  };
  const cols = showStaff ? 5 : 4;

  return (
    <div className={WRAP}>
      <table className="w-full text-sm">
        <thead className={HEAD}>
          <tr>
            <th className="px-4 py-2 text-left font-semibold">Received</th>
            <th className="px-4 py-2 text-left font-semibold">Guest / booking</th>
            <th className="px-4 py-2 text-left font-semibold">Room</th>
            <th className="px-4 py-2 text-left font-semibold">Mode</th>
            {showStaff ? <th className="px-4 py-2 text-left font-semibold">Received by</th> : null}
            <th className="px-4 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-border/60 break-inside-avoid border-t">
              <td className="text-muted-foreground px-4 py-2.5 whitespace-nowrap tabular-nums">
                {fmt(p.createdAt)}
              </td>
              <td className="px-4 py-2.5">
                <span className="font-medium">{p.guestName}</span>
                <span className="text-muted-foreground block font-mono text-xs">
                  {p.bookingRef}
                  {p.source ? ` · ${BOOKING_SOURCE_LABELS[p.source] ?? p.source}` : ""}
                </span>
              </td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                {p.roomLabel ? `Room ${p.roomLabel}` : "—"}
                {p.roomTypeName ? (
                  <span className="text-muted-foreground block text-xs">{p.roomTypeName}</span>
                ) : null}
              </td>
              <td className="px-4 py-2.5">
                {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                {p.reference ? (
                  <span className="text-muted-foreground block font-mono text-xs">
                    {p.reference}
                  </span>
                ) : null}
              </td>
              {showStaff ? (
                <td className="px-4 py-2.5">{p.recordedByName ?? "Unattributed"}</td>
              ) : null}
              <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                {peso.format(p.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        {/* Cash first, because that is the line the two people signing the sheet
            actually count out between them. */}
        <tfoot className="break-inside-avoid">
          <tr className="bg-muted/40 border-t font-medium">
            <td className="px-4 py-2.5" colSpan={cols}>
              Cash to remit
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums">{peso.format(cash)}</td>
          </tr>
          <tr className="border-border/60 border-t">
            <td className="text-muted-foreground px-4 py-2.5" colSpan={cols}>
              Non-cash (already in an account)
            </td>
            <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">
              {peso.format(total - cash)}
            </td>
          </tr>
          <tr className="bg-muted/40 border-border/60 border-t font-semibold">
            <td className="px-4 py-2.5" colSpan={cols}>
              Total collected · {payments.length} transaction
              {payments.length === 1 ? "" : "s"}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums">{peso.format(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
