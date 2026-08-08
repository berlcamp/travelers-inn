"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, includesValue } from "@/components/shared/data-table";
import { RoomStatusSelect } from "./room-status-select";
import { RoomFormDialog } from "./room-form-dialog";
import { RoomDeleteButton } from "./room-delete-button";
import type { RoomType, RoomWithType } from "@/features/rooms/repository";
import { ROOM_STATUSES, ROOM_STATUS_LABELS, type RoomStatus } from "@/features/rooms/schemas";

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
      filterFn: includesValue,
    },
    {
      accessorKey: "status",
      header: "Status",
      filterFn: includesValue,
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
        <div className="flex justify-end gap-1">
          <RoomFormDialog
            room={row.original}
            roomTypes={roomTypes}
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label="Edit room">
                <Pencil />
              </Button>
            }
          />
          <RoomDeleteButton roomId={row.original.id} label={row.original.label} />
        </div>
      ),
    });
  }

  // Built from the room-type table rather than from the loaded rows, so a
  // filter that matches nothing still shows why.
  const typeOptions = roomTypes.map((t) => ({ value: t.name, label: t.name }));

  return (
    <DataTable
      columns={columns}
      data={rooms}
      searchPlaceholder="Search rooms…"
      filterableColumns={[
        { id: "type", title: "Type", options: typeOptions },
        {
          id: "status",
          title: "Status",
          options: ROOM_STATUSES.map((s) => ({ value: s, label: ROOM_STATUS_LABELS[s] })),
        },
      ]}
      emptyMessage="No rooms yet."
    />
  );
}
