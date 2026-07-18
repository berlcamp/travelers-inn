import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Tags } from "lucide-react";
import { requireUser, hasRole } from "@/lib/auth/guards";
import { listRoomsWithType, listRoomTypes } from "@/features/rooms/repository";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { RoomsTable } from "@/features/rooms/components/rooms-table";
import { RoomFormDialog } from "@/features/rooms/components/room-form-dialog";

export const metadata: Metadata = { title: "Rooms" };

export default async function RoomsPage() {
  const user = await requireUser();
  const isAdmin = hasRole(user, "admin");
  const [rooms, roomTypes] = await Promise.all([listRoomsWithType(), listRoomTypes()]);
  const activeTypes = roomTypes.filter((t) => t.is_active);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Rooms"
        description="Physical rooms and their housekeeping status."
        actions={
          isAdmin && activeTypes.length > 0 ? (
            <RoomFormDialog
              roomTypes={activeTypes}
              trigger={
                <Button>
                  <Plus className="size-4" /> Add room
                </Button>
              }
            />
          ) : null
        }
      />

      {roomTypes.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No room types yet"
          description="Create a room type first — rooms belong to a type that carries the pricing."
          action={
            isAdmin ? (
              <Button render={<Link href="/room-types" />} nativeButton={false} variant="outline">
                Go to Room Types
              </Button>
            ) : null
          }
        />
      ) : (
        <RoomsTable rooms={rooms} roomTypes={activeTypes} isAdmin={isAdmin} />
      )}
    </div>
  );
}
