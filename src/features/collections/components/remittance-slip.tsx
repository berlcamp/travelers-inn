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
    <div className="hidden print:mb-4 print:block print:border-b print:border-neutral-400 print:pb-3">
      <p className="text-xs tracking-[0.2em] uppercase">Bañares Traveler&apos;s Inn</p>
      <h1 className="mt-0.5 text-lg font-bold">Collections &amp; Remittance Report</h1>
      <dl className="mt-2 grid grid-cols-3 gap-x-6 text-xs">
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
export function SignatureBlock({ cash, total }: { cash: number; total: number }) {
  return (
    <div className="hidden break-inside-avoid print:mt-6 print:block">
      <div className="mb-4 flex justify-end gap-8 text-sm">
        <div className="text-right">
          <p className="text-xs text-neutral-500 uppercase">Total collected</p>
          <p className="font-medium tabular-nums">{peso.format(total)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-neutral-500 uppercase">Cash turned over</p>
          <p className="text-base font-bold tabular-nums">{peso.format(cash)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-10">
        {["Turned over by", "Received by"].map((role) => (
          <div key={role}>
            <div className="h-10" />
            <div className="border-t border-neutral-500 pt-1">
              <p className="text-xs font-medium">{role}</p>
              <p className="text-[0.65rem] text-neutral-500">
                Signature over printed name &nbsp;·&nbsp; Date
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
