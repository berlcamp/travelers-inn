import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { pageRole } from "@/lib/auth/guards";
import { AccessDenied } from "@/components/shared/access-denied";
import { listRoomTypes } from "@/features/rooms/repository";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { RoomTypesTable } from "@/features/rooms/components/room-types-table";
import { RoomTypeFormDialog } from "@/features/rooms/components/room-type-form-dialog";

export const metadata: Metadata = { title: "Room Types" };

export default async function RoomTypesPage() {
  const allowed = await pageRole(["admin"]);
  if (!allowed) return <AccessDenied requires={["admin"]} />;
  const roomTypes = await listRoomTypes();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Room Types"
        description="Define the categories of rooms, their occupancy, and rate tiers."
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
