import { cn } from "@/lib/utils";
import type { CalendarData, CalendarCell } from "@/features/bookings/calendar";

// Occupancy fill by lifecycle stage.
function cellClasses(cell: CalendarCell): string {
  if (!cell.occupied) return "";
  switch (cell.status) {
    case "checked_in":
      return "bg-emerald-500/25 dark:bg-emerald-400/25";
    case "checked_out":
      return "bg-muted-foreground/15";
    default: // confirmed
      return "bg-primary/20";
  }
}

export function CalendarGrid({ data }: { data: CalendarData }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/40">
            <th className="bg-card sticky left-0 z-10 min-w-40 border-b border-r px-3 py-2 text-left font-medium">
              Room
            </th>
            {data.days.map((d, i) => (
              <th
                key={i}
                className={cn(
                  "min-w-16 border-b px-2 py-1 text-center font-medium",
                  d.isWeekend && "bg-muted/60"
                )}
              >
                <div className="text-muted-foreground text-[11px] leading-tight">{d.weekday}</div>
                <div className="text-xs leading-tight">{d.day}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.roomId} className="border-b last:border-b-0">
              <th className="bg-card sticky left-0 z-10 border-r px-3 py-2 text-left font-normal">
                <div className="font-medium">Room {row.label}</div>
                <div className="text-muted-foreground text-xs">{row.typeName}</div>
              </th>
              {row.cells.map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    "h-11 border-l px-1 text-center align-middle",
                    data.days[i]?.isWeekend && !cell.occupied && "bg-muted/30",
                    cellClasses(cell)
                  )}
                  title={cell.occupied ? cell.guestName : undefined}
                >
                  {cell.occupied && cell.isStart ? (
                    <span className="line-clamp-1 text-[11px] font-medium">{cell.guestName}</span>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
