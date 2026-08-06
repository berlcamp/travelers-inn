import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// A flat tile rather than a Card: the figure is the point, and card padding
// plus a header row buries it. Same chrome as the table shell so a row of
// tiles above a list reads as one surface.
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  className,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("border-border/60 bg-card rounded-xl border p-4 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {label}
        </p>
        {Icon ? <Icon className="text-muted-foreground/60 size-4 shrink-0" /> : null}
      </div>
      <p className="mt-0.5 truncate text-xl leading-tight font-bold tabular-nums">{value}</p>
      {hint ? <p className="text-muted-foreground mt-0.5 truncate text-xs">{hint}</p> : null}
    </div>
  );
}
