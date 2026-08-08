"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, includesValue } from "@/components/shared/data-table";
import { RoomHousekeeping } from "./room-housekeeping";
import { RoomOccupancyCell } from "./room-occupancy-cell";
import { RoomFormDialog } from "./room-form-dialog";
import { RoomDeleteButton } from "./room-delete-button";
import type { RoomType, RoomWithOccupancy } from "@/features/rooms/repository";
import { OCCUPANCY_LABELS, type OccupancyKind } from "@/features/rooms/occupancy";
import { ROOM_STATUSES, ROOM_STATUS_LABELS, type RoomStatus } from "@/features/rooms/schemas";

// Two columns, because they answer two different questions and only one of them
// is anybody's opinion:
//   * Guest    — derived from bookings, read-only. Who is in the room.
//   * Housekeeping — the rooms.status column: is it clean, is it usable.
// They used to be conflated in a single free-choice dropdown, which let staff
// mark a room "vacant" while a guest was checked into it.
export function RoomsTable({
  rooms,
  roomTypes,
  isAdmin,
}: {
  rooms: RoomWithOccupancy[];
  roomTypes: RoomType[];
  isAdmin: boolean;
}) {
  const columns: ColumnDef<RoomWithOccupancy>[] = [
    { accessorKey: "label", header: "Room" },
    {
      id: "type",
      header: "Type",
      accessorFn: (row) => row.room_type?.name ?? "—",
      filterFn: includesValue,
    },
    {
      id: "occupancy",
      header: "Guest",
      accessorFn: (row) => OCCUPANCY_LABELS[row.occupancy.kind],
      filterFn: includesValue,
      cell: ({ row }) => <RoomOccupancyCell occupancy={row.original.occupancy} />,
    },
    {
      accessorKey: "status",
      header: "Housekeeping",
      filterFn: includesValue,
      cell: ({ row }) => (
        <RoomHousekeeping roomId={row.original.id} status={row.original.status as RoomStatus} />
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
  const occupancyOptions = (["in_house", "arriving", "free"] as OccupancyKind[]).map((k) => ({
    value: OCCUPANCY_LABELS[k],
    label: OCCUPANCY_LABELS[k],
  }));

  return (
    <DataTable
      columns={columns}
      data={rooms}
      searchPlaceholder="Search rooms…"
      filterableColumns={[
        { id: "type", title: "Type", options: typeOptions },
        { id: "occupancy", title: "Guest", options: occupancyOptions },
        {
          id: "status",
          title: "Housekeeping",
          options: ROOM_STATUSES.map((s) => ({ value: s, label: ROOM_STATUS_LABELS[s] })),
        },
      ]}
      emptyMessage="No rooms yet."
    />
  );
}
