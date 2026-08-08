"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Dates and nothing else.
 *
 * The page deliberately has one control. Whose collections these are is not a
 * choice a clerk makes — it is decided by who is signed in (front desk sees
 * their own sheet, and that is enforced on the server, not here), so it was
 * never a filter so much as a picker only an admin could move. Payment mode and
 * the range presets went with it: the mode split is already on the sheet as
 * cash vs non-cash, and a date input is one tap more than a preset.
 *
 * The range still rides in the URL (`?from=&to=`), so a sheet stays reloadable
 * and shareable — nothing hidden in client state decides what the figures
 * cover.
 */
export function CollectionsFilters({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  function apply() {
    // A backwards range would report zero of everything; swap instead.
    const [a, b] = draftFrom > draftTo ? [draftTo, draftFrom] : [draftFrom, draftTo];
    setDraftFrom(a);
    setDraftTo(b);
    startTransition(() => router.push(`/collections?from=${a}&to=${b}`));
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
      <Button variant="outline" disabled={pending} onClick={apply}>
        {pending ? "Loading…" : "Apply"}
      </Button>

      <Button variant="outline" size="sm" onClick={() => window.print()}>
        <Printer className="size-4" /> Print
      </Button>
    </div>
  );
}
