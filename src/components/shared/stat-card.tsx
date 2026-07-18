import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
    <Card className={cn("py-4", className)}>
      <CardContent className="flex items-center gap-3 px-4">
        {Icon ? (
          <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-4" />
          </div>
        ) : null}
        <div className="flex flex-col overflow-hidden">
          <span className="text-muted-foreground truncate text-xs">{label}</span>
          <span className="text-xl font-semibold tabular-nums">{value}</span>
          {hint ? <span className="text-muted-foreground truncate text-xs">{hint}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
