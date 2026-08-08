"use client";

import { BedDouble, CircleSlash, LogIn } from "lucide-react";
import type { RoomOccupancy } from "@/features/rooms/occupancy";

// Read-only by construction — occupancy is derived from bookings on every
// render (features/rooms/occupancy.ts), so there is nothing here to edit. To
// change it you check a guest in or out, which is the point.
export function RoomOccupancyCell({ occupancy }: { occupancy: RoomOccupancy }) {
  if (occupancy.kind === "free") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
        <CircleSlash className="size-3.5" /> Free
      </span>
    );
  }

  const inHouse = occupancy.kind === "in_house";
  const Icon = inHouse ? BedDouble : LogIn;
  const note = inHouse
    ? occupancy.departingToday
      ? "Departing today"
      : null
    : occupancy.awaitingDeposit
      ? "Deposit not verified"
      : null;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        <Icon className={`size-3.5 ${inHouse ? "text-blue-600" : "text-amber-600"}`} />
        {occupancy.guestName}
      </span>
      <span className="text-muted-foreground text-xs">
        {inHouse ? "In house" : "Arriving today"}
        {note ? ` · ${note}` : ""}
      </span>
    </div>
  );
}
