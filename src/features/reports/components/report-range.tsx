"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isoDate } from "@/features/reports/analytics";
import type { ReportFilterOptions } from "@/features/reports/repository";
import { innAddDays, innParts, innTime } from "@/lib/inn-time";

// Presets are computed from the browser's clock at click time. The page itself
// is rendered from the URL's from/to, so a report is always shareable and
// reloadable — no hidden client state decides what the numbers cover. The two
// filters work the same way and ride in the same query string.
function presets(): { label: string; from: string; to: string }[] {
  // Months and days as the INN counts them (src/lib/inn-time.ts) — a report
  // range typed here is read back by the server on that same clock.
  const today = new Date();
  const { year, month } = innParts(today);
  const startOfMonth = innTime(year, month, 1);
  const lastMonthStart = innTime(year, month - 1, 1);
  const lastMonthEnd = innAddDays(startOfMonth, -1);
  const weekAgo = innAddDays(today, -6);

  return [
    { label: "Today", from: isoDate(today), to: isoDate(today) },
    { label: "Last 7 days", from: isoDate(weekAgo), to: isoDate(today) },
    { label: "This month", from: isoDate(startOfMonth), to: isoDate(today) },
    { label: "Last month", from: isoDate(lastMonthStart), to: isoDate(lastMonthEnd) },
  ];
}

// Base UI's Select has no "no value" item, so the all-of-them choice needs a
// real value; it's translated to an absent query param on the way out.
const ALL = "__all__";

type Query = { from: string; to: string; roomType: string | null; staff: string | null };

function href(q: Query): string {
  const params = new URLSearchParams({ from: q.from, to: q.to });
  if (q.roomType) params.set("roomType", q.roomType);
  if (q.staff) params.set("staff", q.staff);
  return `/reports?${params}`;
}

export function ReportRange({
  from,
  to,
  roomTypeId,
  staffId,
  options,
}: {
  from: string;
  to: string;
  roomTypeId: string | null;
  staffId: string | null;
  options: ReportFilterOptions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  // Every navigation carries the current filters, so changing the date range
  // never silently drops the room type a user picked, and vice versa.
  function go(next: Partial<Query>) {
    const q: Query = { from, to, roomType: roomTypeId, staff: staffId, ...next };
    // A backwards range would silently report zero of everything; swap instead.
    if (q.from > q.to) [q.from, q.to] = [q.to, q.from];
    setDraftFrom(q.from);
    setDraftTo(q.to);
    startTransition(() => router.push(href(q)));
  }

  const roomTypeItems = [
    { value: ALL, label: "All room types" },
    ...options.roomTypes.map((t) => ({ value: t.id, label: t.name })),
  ];
  const staffItems = [
    { value: ALL, label: "All staff" },
    ...options.staff.map((s) => ({ value: s.id, label: s.name })),
  ];
  const filtered = Boolean(roomTypeId || staffId);

  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <div className="flex flex-col gap-1">
        <label htmlFor="from" className="text-muted-foreground text-xs">
          From
        </label>
        <Input
          id="from"
          type="date"
          className="w-40"
          value={draftFrom}
          onChange={(e) => setDraftFrom(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="to" className="text-muted-foreground text-xs">
          To
        </label>
        <Input
          id="to"
          type="date"
          className="w-40"
          value={draftTo}
          onChange={(e) => setDraftTo(e.target.value)}
        />
      </div>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => go({ from: draftFrom, to: draftTo })}
      >
        {pending ? "Loading…" : "Apply"}
      </Button>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Room type</span>
        <Select
          items={roomTypeItems}
          value={roomTypeId ?? ALL}
          onValueChange={(v) => go({ roomType: v === ALL || !v ? null : String(v) })}
          disabled={pending}
        >
          <SelectTrigger className="w-48" aria-label="Filter by room type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roomTypeItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Receptionist</span>
        <Select
          items={staffItems}
          value={staffId ?? ALL}
          onValueChange={(v) => go({ staff: v === ALL || !v ? null : String(v) })}
          disabled={pending}
        >
          <SelectTrigger className="w-48" aria-label="Filter by receptionist">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {staffItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => go({ roomType: null, staff: null })}
        >
          <X className="size-4" /> Clear filters
        </Button>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {presets().map((p) => (
          <Button
            key={p.label}
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => go({ from: p.from, to: p.to })}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={() => window.print()}>
        <Printer className="size-4" /> Print
      </Button>
    </div>
  );
}
