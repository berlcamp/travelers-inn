import { peso } from "@/features/bookings/pricing";
import type { TrendPoint } from "@/features/reports/reports";

// Dependency-free bar chart for a 7-point series.
export function TrendBars({
  points,
  format,
}: {
  points: TrendPoint[];
  format: "peso" | "count";
}) {
  return (
    <div className="flex h-[120px] items-end gap-2">
      {points.map((p, i) => {
        const pct = p.max > 0 ? Math.round((100 * p.value) / p.max) : 0;
        const label = format === "peso" ? peso.format(p.value) : String(p.value);
        return (
          <div key={i} className="flex h-full flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full flex-1 items-end">
              <div
                className="bg-primary/80 hover:bg-primary w-full rounded-t-md transition-colors"
                style={{ height: `${p.value > 0 ? Math.max(pct, 6) : 0}%` }}
                title={label}
              />
            </div>
            <span className="text-muted-foreground text-[10px]">{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}
