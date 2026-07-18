"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { RoomStatusSelect } from "./room-status-select";
import { RoomFormDialog } from "./room-form-dialog";
import type { RoomType, RoomWithType } from "@/features/rooms/repository";
import type { RoomStatus } from "@/features/rooms/schemas";

export function RoomsTable({
  rooms,
  roomTypes,
  isAdmin,
}: {
  rooms: RoomWithType[];
  roomTypes: RoomType[];
  isAdmin: boolean;
}) {
  const columns: ColumnDef<RoomWithType>[] = [
    { accessorKey: "label", header: "Room" },
    {
      id: "type",
      header: "Type",
      accessorFn: (row) => row.room_type?.name ?? "—",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <RoomStatusSelect roomId={row.original.id} status={row.original.status as RoomStatus} />
      ),
    },
    {
      accessorKey: "notes",
      header: "Notes",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">{row.original.notes || "—"}</span>
      ),
    },
  ];

  if (isAdmin) {
    columns.push({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RoomFormDialog
            room={row.original}
            roomTypes={roomTypes}
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label="Edit room">
                <Pencil />
              </Button>
            }
          />
        </div>
      ),
    });
  }

  return (
    <DataTable
      columns={columns}
      data={rooms}
      searchPlaceholder="Search rooms…"
      emptyMessage="No rooms yet."
    />
  );
}
