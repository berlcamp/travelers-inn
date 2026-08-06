"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isoDate } from "@/features/reports/analytics";

// Presets are computed from the browser's clock at click time. The page itself
// is rendered from the URL's from/to, so a report is always shareable and
// reloadable — no hidden client state decides what the numbers cover.
function presets(): { label: string; from: string; to: string }[] {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);

  return [
    { label: "Today", from: isoDate(today), to: isoDate(today) },
    { label: "Last 7 days", from: isoDate(weekAgo), to: isoDate(today) },
    { label: "This month", from: isoDate(startOfMonth), to: isoDate(today) },
    { label: "Last month", from: isoDate(lastMonthStart), to: isoDate(lastMonthEnd) },
  ];
}

export function ReportRange({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  function apply(nextFrom: string, nextTo: string) {
    // A backwards range would silently report zero of everything; swap instead.
    const [a, b] = nextFrom <= nextTo ? [nextFrom, nextTo] : [nextTo, nextFrom];
    setDraftFrom(a);
    setDraftTo(b);
    startTransition(() => router.push(`/reports?from=${a}&to=${b}`));
  }

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
      <Button variant="outline" disabled={pending} onClick={() => apply(draftFrom, draftTo)}>
        {pending ? "Loading…" : "Apply"}
      </Button>

      <div className="flex flex-wrap gap-1.5">
        {presets().map((p) => (
          <Button
            key={p.label}
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => apply(p.from, p.to)}
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
