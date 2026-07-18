"use client";

import { useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/shared/data-table";
import { RoomTypeFormDialog } from "./room-type-form-dialog";
import { toggleRoomTypeActive } from "@/features/rooms/actions";
import type { RoomType } from "@/features/rooms/repository";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

function RowActions({ roomType }: { roomType: RoomType }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await toggleRoomTypeActive(roomType.id, !roomType.is_active);
      if (result.ok) {
        toast.success(roomType.is_active ? "Deactivated." : "Activated.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Actions">
              <MoreHorizontal />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <RoomTypeFormDialog
            roomType={roomType}
            trigger={
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <Pencil className="size-4" /> Edit
              </DropdownMenuItem>
            }
          />
          <DropdownMenuItem onClick={toggle} disabled={pending}>
            {roomType.is_active ? (
              <>
                <PowerOff className="size-4" /> Deactivate
              </>
            ) : (
              <>
                <Power className="size-4" /> Activate
              </>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const columns: ColumnDef<RoomType>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "capacity", header: "Capacity" },
  {
    accessorKey: "nightly_rate",
    header: "Nightly",
    cell: ({ row }) => peso.format(Number(row.original.nightly_rate)),
  },
  {
    accessorKey: "hourly_rate",
    header: "Hourly",
    cell: ({ row }) =>
      row.original.hourly_rate != null ? peso.format(Number(row.original.hourly_rate)) : "—",
  },
  {
    accessorKey: "is_active",
    header: "Status",
    cell: ({ row }) =>
      row.original.is_active ? (
        <Badge>Active</Badge>
      ) : (
        <Badge variant="secondary">Inactive</Badge>
      ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <RowActions roomType={row.original} />,
  },
];

export function RoomTypesTable({ roomTypes }: { roomTypes: RoomType[] }) {
  return (
    <DataTable
      columns={columns}
      data={roomTypes}
      searchPlaceholder="Search room types…"
      emptyMessage="No room types yet. Add your first one."
    />
  );
}
