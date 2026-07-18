import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { listBookings } from "@/features/bookings/repository";
import { listActiveRoomTypes } from "@/features/rooms/repository";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { BookingsTable } from "@/features/bookings/components/bookings-table";
import { WalkInDialog } from "@/features/bookings/components/walk-in-dialog";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage() {
  await requireRole(["admin", "front_desk"]);
  const [bookings, roomTypes] = await Promise.all([listBookings(), listActiveRoomTypes()]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Bookings"
        description="Reservations and walk-ins across all rooms."
        actions={
          roomTypes.length > 0 ? (
            <WalkInDialog
              roomTypes={roomTypes}
              trigger={
                <Button>
                  <Plus className="size-4" /> New walk-in
                </Button>
              }
            />
          ) : null
        }
      />
      <BookingsTable bookings={bookings} />
    </div>
  );
}
