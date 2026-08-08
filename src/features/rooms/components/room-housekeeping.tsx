"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Sparkles, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { markRoomClean, setRoomOutOfService } from "@/features/rooms/actions";
import { ROOM_STATUS_LABELS, type RoomStatus } from "@/features/rooms/schemas";

// The housekeeping state plus the only two transitions a person is the source
// of. `occupied` and `cleaning` appear here as read-only badges: the stay
// lifecycle writes them at check-in and check-out, and there is no control to
// type them by hand — that was the old dropdown, and it let the column
// contradict the bookings underneath it.
const BADGE: Record<RoomStatus, string> = {
  vacant: "bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-600/15",
  occupied: "bg-blue-500/12 text-blue-700 ring-1 ring-blue-600/15",
  cleaning: "bg-amber-500/12 text-amber-700 ring-1 ring-amber-600/15",
  out_of_service: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
};

export function RoomHousekeeping({ roomId, status }: { roomId: string; status: RoomStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  const outOfService = status === "out_of_service";

  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className={`border-transparent ${BADGE[status]}`}>
        {ROOM_STATUS_LABELS[status]}
      </Badge>

      {status === "cleaning" ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => markRoomClean(roomId), "Room is ready.")}
        >
          <Sparkles className="size-4" /> Mark clean
        </Button>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        className={outOfService ? undefined : "text-muted-foreground"}
        onClick={() =>
          run(
            () => setRoomOutOfService(roomId, !outOfService),
            outOfService ? "Room is back in service." : "Room taken out of service."
          )
        }
      >
        <Wrench className="size-4" />
        {outOfService ? "Back in service" : "Out of service"}
      </Button>
    </div>
  );
}
