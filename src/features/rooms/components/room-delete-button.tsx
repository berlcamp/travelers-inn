"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { deleteRoom } from "@/features/rooms/actions";

// Admin-only (the whole actions column is), and only ever succeeds on a room
// with no bookings — see deleteRoom. The refusal for a used room comes back as
// an ordinary error toast rather than being hidden here, because whether a room
// has history isn't known at render time.
export function RoomDeleteButton({ roomId, label }: { roomId: string; label: string }) {
  const router = useRouter();

  return (
    <ConfirmDialog
      trigger={
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:bg-destructive/10"
          aria-label={`Delete room ${label}`}
        >
          <Trash2 />
        </Button>
      }
      title={`Delete room ${label}?`}
      description={
        "This can't be undone, and any guest feedback left for this room is deleted with it. " +
        "A room that has already been booked can't be deleted — set it Out of service instead."
      }
      confirmLabel="Delete room"
      onConfirm={async () => {
        const result = await deleteRoom(roomId);
        if (result.ok) {
          toast.success(`Room ${label} deleted.`);
          router.refresh();
        } else {
          toast.error(result.error);
        }
      }}
    />
  );
}
