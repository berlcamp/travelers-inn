"use client";

import { describeTrailEntry } from "@/features/bookings/trail";
import type { TrailEntry } from "@/features/bookings/repository";

const dt = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Chronological record of who did what to this booking, read from audit_logs
// via fn_booking_trail. A portal booking's first entries have no actor — the
// guest made them — so those read "Guest (online)" rather than a blank.
export function ActivityTrail({ entries }: { entries: TrailEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">No recorded activity yet for this booking.</p>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {entries.map((entry) => {
        const { label, detail } = describeTrailEntry(entry.action, entry.diff);
        return (
          <li key={entry.id} className="flex gap-2 text-xs">
            <span className="bg-border mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">
                {label}
                {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
              </span>
              <span className="text-muted-foreground">
                {entry.actorName ?? (entry.actorId ? "Former staff member" : "Guest (online)")} ·{" "}
                {dt.format(new Date(entry.createdAt))}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
