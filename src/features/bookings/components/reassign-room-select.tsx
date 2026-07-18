"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reassignRoom } from "@/features/bookings/front-desk-actions";

// Reassign a booking to another free room of its type. Options come from
// fn_available_rooms (which already excludes this booking's own conflict).
export function ReassignRoomSelect({
  bookingId,
  currentRoomId,
  rooms,
  onDone,
}: {
  bookingId: string;
  currentRoomId: string;
  rooms: { id: string; label: string }[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const items = rooms.map((r) => ({ value: r.id, label: `Room ${r.label}` }));

  function onChange(next: string | null) {
    if (!next || next === currentRoomId) return;
    startTransition(async () => {
      const result = await reassignRoom(bookingId, next);
      if (result.ok) {
        toast.success("Room reassigned.");
        onDone();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Select
      items={items}
      value={currentRoomId}
      onValueChange={onChange}
      disabled={pending || rooms.length <= 1}
    >
      <SelectTrigger className="h-9 w-full" aria-label="Assigned room">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((it) => (
          <SelectItem key={it.value} value={it.value}>
            {it.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
