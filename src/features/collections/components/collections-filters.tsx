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
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/features/bookings/payment-schema";

// A remittance sheet covers a SHIFT, so the presets are short — today first,
// yesterday second (the sheet you write up the next morning). The month is
// there for a supervisor totalling up, not for the desk.
function presets(): { label: string; from: string; to: string }[] {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  return [
    { label: "Today", from: isoDate(today), to: isoDate(today) },
    { label: "Yesterday", from: isoDate(yesterday), to: isoDate(yesterday) },
    { label: "Last 7 days", from: isoDate(weekAgo), to: isoDate(today) },
    { label: "This month", from: isoDate(monthStart), to: isoDate(today) },
  ];
}

// Base UI's Select has no "no value" item, so the all-of-them choice needs a
// real value; it becomes an absent query param on the way out.
const ALL = "__all__";

type Query = { from: string; to: string; staff: string | null; method: string | null };

function href(q: Query): string {
  const params = new URLSearchParams({ from: q.from, to: q.to });
  if (q.staff) params.set("staff", q.staff);
  if (q.method) params.set("method", q.method);
  return `/collections?${params}`;
}

export function CollectionsFilters({
  from,
  to,
  staffId,
  method,
  staff,
  canPickStaff,
}: {
  from: string;
  to: string;
  staffId: string | null;
  method: string | null;
  staff: { id: string; name: string }[];
  /** Admin only. Front desk is pinned to their own collections by the page, so
   *  they get no picker rather than a picker that refuses to move. */
  canPickStaff: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  // Every navigation carries the current filters, so changing the dates never
  // silently drops the receptionist someone selected, and vice versa.
  function go(next: Partial<Query>) {
    const q: Query = { from, to, staff: staffId, method, ...next };
    // A backwards range would report zero of everything; swap instead.
    if (q.from > q.to) [q.from, q.to] = [q.to, q.from];
    setDraftFrom(q.from);
    setDraftTo(q.to);
    startTransition(() => router.push(href(q)));
  }

  const staffItems = [
    { value: ALL, label: "All receptionists" },
    ...staff.map((s) => ({ value: s.id, label: s.name })),
  ];
  const methodItems = [
    { value: ALL, label: "All modes" },
    ...PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] })),
  ];
  const filtered = Boolean(method || (canPickStaff && staffId));

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

      {canPickStaff ? (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Receptionist</span>
          <Select
            items={staffItems}
            value={staffId ?? ALL}
            onValueChange={(v) => go({ staff: v === ALL || !v ? null : String(v) })}
            disabled={pending}
          >
            <SelectTrigger className="w-52" aria-label="Filter by receptionist">
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
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Payment mode</span>
        <Select
          items={methodItems}
          value={method ?? ALL}
          onValueChange={(v) => go({ method: v === ALL || !v ? null : String(v) })}
          disabled={pending}
        >
          <SelectTrigger className="w-44" aria-label="Filter by payment mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {methodItems.map((i) => (
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
          onClick={() => go({ staff: canPickStaff ? null : staffId, method: null })}
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
