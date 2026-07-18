"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateRoomStatus } from "@/features/rooms/actions";
import { ROOM_STATUSES, ROOM_STATUS_LABELS, type RoomStatus } from "@/features/rooms/schemas";

// Inline housekeeping status control — usable by front desk and admin.
export function RoomStatusSelect({ roomId, status }: { roomId: string; status: RoomStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(next: string | null) {
    if (!next || next === status) return;
    startTransition(async () => {
      const result = await updateRoomStatus(roomId, next as RoomStatus);
      if (result.ok) {
        toast.success(`Marked ${ROOM_STATUS_LABELS[next as RoomStatus].toLowerCase()}.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const items = ROOM_STATUSES.map((s) => ({ value: s, label: ROOM_STATUS_LABELS[s] }));

  return (
    <Select items={items} value={status} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-8 w-40" aria-label="Room status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROOM_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {ROOM_STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
