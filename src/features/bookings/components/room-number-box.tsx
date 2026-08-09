"use client";

import { DoorOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The room number, big enough to read across a counter.
 *
 * One component rather than three copies because the clerk sees this in three
 * places that must agree: the walk-in confirmation, the online-deposit
 * confirmation, and the booking's manage dialog. In the manage dialog it sits
 * directly above the reassign select, so moving a guest to another room redraws
 * this box — the number they read out is always the current one.
 *
 * `typeName` is optional: the manage dialog already carries "Room type" in its
 * summary grid, so it passes nothing rather than printing it twice.
 */
export function RoomNumberBox({
  label,
  typeName,
  className,
}: {
  label: string | null;
  typeName?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border/60 bg-muted/40 flex flex-col items-center gap-1 rounded-xl border p-5 text-center",
        className
      )}
    >
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase">
        <DoorOpen className="size-3.5" /> Room
      </span>
      <span className="text-4xl leading-none font-bold tabular-nums">{label ?? "—"}</span>
      {typeName ? <span className="text-muted-foreground text-sm">{typeName}</span> : null}
    </div>
  );
}
