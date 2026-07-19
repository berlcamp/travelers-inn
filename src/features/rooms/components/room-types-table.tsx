"use client";

import { useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ImageOff, MoreHorizontal, Pencil, Power, PowerOff } from "lucide-react";
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
import type { RoomTypeWithTiers } from "@/features/rooms/repository";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

function RowActions({ roomType }: { roomType: RoomTypeWithTiers }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

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
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" /> Edit
          </DropdownMenuItem>
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
      {/* Rendered as a sibling of the menu (not inside a menu item) so it
          doesn't get torn down when the dropdown dismisses. */}
      <RoomTypeFormDialog roomType={roomType} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

const columns: ColumnDef<RoomTypeWithTiers>[] = [
  {
    id: "photo",
    header: () => <span className="sr-only">Photo</span>,
    cell: ({ row }) =>
      row.original.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.original.image_url}
          alt=""
          className="border-border size-10 rounded-md border object-cover"
        />
      ) : (
        <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-md">
          <ImageOff className="size-4" />
        </div>
      ),
  },
  { accessorKey: "name", header: "Name" },
  {
    id: "occupancy",
    header: "Guests",
    cell: ({ row }) => {
      const t = row.original;
      return (
        <span className="text-sm">
          {t.base_occupancy}–{t.max_occupancy}
          {Number(t.excess_person_rate) > 0 ? (
            <span className="text-muted-foreground text-xs">
              {" "}
              · +{peso.format(Number(t.excess_person_rate))}/head
            </span>
          ) : null}
        </span>
      );
    },
  },
  {
    id: "tiers",
    header: "Rates",
    cell: ({ row }) => {
      const active = row.original.rate_tiers.filter((r) => r.is_active);
      if (active.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {active.map((r) => (
            <span
              key={r.id}
              className="bg-muted text-foreground/80 rounded px-1.5 py-0.5 text-xs"
            >
              {r.label} · {peso.format(Number(r.price))}
            </span>
          ))}
        </div>
      );
    },
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

export function RoomTypesTable({ roomTypes }: { roomTypes: RoomTypeWithTiers[] }) {
  return (
    <DataTable
      columns={columns}
      data={roomTypes}
      searchPlaceholder="Search room types…"
      emptyMessage="No room types yet. Add your first one."
    />
  );
}
