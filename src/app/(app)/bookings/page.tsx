import type { Metadata } from "next";
import { Plus, ShieldAlert } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { listBookingsWithStaff, countPendingVerification } from "@/features/bookings/repository";
import { listActiveRoomTypes } from "@/features/rooms/repository";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { BookingsTable } from "@/features/bookings/components/bookings-table";
import { WalkInDialog } from "@/features/bookings/components/walk-in-dialog";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage() {
  await requireRole(["admin", "front_desk"]);
  const [bookings, roomTypes, pendingCount] = await Promise.all([
    listBookingsWithStaff(),
    listActiveRoomTypes(),
    countPendingVerification(),
  ]);

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
      {pendingCount > 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <ShieldAlert className="size-4 shrink-0 text-amber-600" />
          <span>
            <strong>{pendingCount}</strong> booking{pendingCount === 1 ? "" : "s"} awaiting payment
            verification. Open one to review the proof and confirm.
          </span>
        </div>
      ) : null}
      <BookingsTable bookings={bookings} />
    </div>
  );
}
