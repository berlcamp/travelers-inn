import { peso } from "@/features/bookings/pricing";
import type { Bucket } from "@/features/reports/analytics";

// One shape for every "grouped by X" block in the reports page: count on the
// left, money on the right, share of the total as a bar behind the row.
export function BreakdownTable({
  buckets,
  countLabel = "Count",
  amountLabel = "Amount",
  labelOf,
  emptyText = "Nothing in this range.",
  showAmount = true,
}: {
  buckets: Bucket[];
  countLabel?: string;
  amountLabel?: string;
  labelOf?: (bucket: Bucket) => string;
  emptyText?: string;
  showAmount?: boolean;
}) {
  if (buckets.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyText}</p>;
  }

  const total = buckets.reduce((acc, b) => acc + (showAmount ? b.amount : b.count), 0);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-xs">
          <th className="pb-1 text-left font-normal">&nbsp;</th>
          <th className="pb-1 text-right font-normal">{countLabel}</th>
          {showAmount ? <th className="pb-1 text-right font-normal">{amountLabel}</th> : null}
        </tr>
      </thead>
      <tbody>
        {buckets.map((b) => {
          const value = showAmount ? b.amount : b.count;
          const pct = total > 0 ? Math.round((100 * value) / total) : 0;
          return (
            <tr key={b.key} className="border-border/60 border-t">
              <td className="py-1.5">
                <div className="flex flex-col gap-1">
                  <span>{labelOf ? labelOf(b) : b.label}</span>
                  <span
                    className="bg-primary/70 h-1 rounded-full"
                    style={{ width: `${Math.max(pct, 2)}%` }}
                    aria-hidden
                  />
                </div>
              </td>
              <td className="py-1.5 text-right tabular-nums">{b.count}</td>
              {showAmount ? (
                <td className="py-1.5 text-right font-medium tabular-nums">
                  {peso.format(b.amount)}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
