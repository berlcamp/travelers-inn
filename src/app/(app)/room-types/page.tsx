import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { listRoomTypes } from "@/features/rooms/repository";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { RoomTypesTable } from "@/features/rooms/components/room-types-table";
import { RoomTypeFormDialog } from "@/features/rooms/components/room-type-form-dialog";

export const metadata: Metadata = { title: "Room Types" };

export default async function RoomTypesPage() {
  await requireRole(["admin"]);
  const roomTypes = await listRoomTypes();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Room Types"
        description="Define the categories of rooms and their nightly and hourly rates."
        actions={
          <RoomTypeFormDialog
            trigger={
              <Button>
                <Plus className="size-4" /> Add room type
              </Button>
            }
          />
        }
      />
      <RoomTypesTable roomTypes={roomTypes} />
    </div>
  );
}
