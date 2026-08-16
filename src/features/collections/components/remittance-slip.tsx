import { peso } from "@/features/bookings/pricing";

// The two print-only pieces that turn a screen of figures into a document two
// people can sign. Both are `hidden print:…` rather than always-on: on screen
// they would be dead space, and a signature line nobody can sign is noise.

const stampFmt = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function PrintHeader({
  period,
  scope,
  printedAt,
}: {
  period: string;
  /** Whose collections — a name, or "All receptionists". */
  scope: string;
  printedAt: Date;
}) {
  return (
    <div className="hidden print:mb-1.5 print:block print:border-b print:border-neutral-400 print:pb-1.5">
      <p className="text-[8px] tracking-[0.2em] uppercase">Bañares Traveler&apos;s Inn</p>
      <h1 className="text-sm font-bold">Collections &amp; Remittance Report</h1>
      <dl className="mt-1 grid grid-cols-3 gap-x-6 text-[9px] leading-tight">
        <div>
          <dt className="text-neutral-500">Period</dt>
          <dd className="font-medium">{period}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Receptionist</dt>
          <dd className="font-medium">{scope}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Printed</dt>
          <dd className="font-medium">{stampFmt.format(printedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * The turn-over block. It restates the cash figure next to the signatures on
 * purpose: a signed sheet whose total lives only on the previous page proves
 * nothing about how much changed hands.
 */
export function SignatureBlock({
  cash,
  total,
  cancelledExcluded,
}: {
  cash: number;
  total: number;
  /** Refunded on cancellations, so absent from both figures above and from the
   *  transaction list. Printed when non-zero: the person signing for the cash
   *  is entitled to know why the sheet is short of the day's takings. */
  cancelledExcluded?: { count: number; amount: number };
}) {
  const refunded = cancelledExcluded && cancelledExcluded.count > 0 ? cancelledExcluded : null;
  return (
    <div className="hidden break-inside-avoid print:mt-3 print:block">
      {refunded ? (
        <p className="mb-1 text-[8px] text-neutral-500">
          Excludes {peso.format(refunded.amount)} received then refunded on {refunded.count}{" "}
          cancelled booking{refunded.count === 1 ? "" : "s"}.
        </p>
      ) : null}
      <div className="mb-2 flex justify-end gap-8 text-xs">
        <div className="text-right">
          <p className="text-[8px] text-neutral-500 uppercase">Total collected</p>
          <p className="font-medium tabular-nums">{peso.format(total)}</p>
        </div>
        <div className="text-right">
          <p className="text-[8px] text-neutral-500 uppercase">Cash turned over</p>
          <p className="text-sm font-bold tabular-nums">{peso.format(cash)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-10">
        {["Turned over by", "Received by"].map((role) => (
          <div key={role}>
            {/* The blank is the point — it is what gets signed. Kept at ~9mm:
                enough to write in, small enough not to cost a page. */}
            <div className="h-7" />
            <div className="border-t border-neutral-500 pt-0.5">
              <p className="text-[9px] font-medium">{role}</p>
              <p className="text-[7px] text-neutral-500">
                Signature over printed name &nbsp;·&nbsp; Date
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
