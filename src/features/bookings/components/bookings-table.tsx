"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { BookingStatusBadge, PaymentStatusBadge } from "./booking-status-badge";
import { BookingManageDialog } from "./booking-manage-dialog";
import { peso } from "@/features/bookings/pricing";
import { STAY_TYPE_LABELS, type BookingStatus } from "@/features/bookings/schemas";
import type { BookingRow } from "@/features/bookings/repository";

const dt = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function fmt(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dt.format(d);
}

function ManageAction({ booking }: { booking: BookingRow }) {
  return (
    <div className="flex justify-end">
      <BookingManageDialog
        bookingId={booking.id}
        trigger={
          <Button variant="outline" size="sm">
            Manage
          </Button>
        }
      />
    </div>
  );
}

const columns: ColumnDef<BookingRow>[] = [
  {
    accessorKey: "reference_code",
    header: "Ref",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference_code}</span>,
  },
  {
    id: "guest",
    header: "Guest",
    accessorFn: (row) => row.guest_name,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.guest_name}</span>
        {row.original.guest_phone ? (
          <span className="text-muted-foreground text-xs">{row.original.guest_phone}</span>
        ) : null}
      </div>
    ),
  },
  {
    id: "room",
    header: "Room",
    accessorFn: (row) => `${row.room?.label ?? ""} ${row.room_type?.name ?? ""}`,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.room?.label ?? "—"}</span>
        <span className="text-muted-foreground text-xs">{row.original.room_type?.name ?? ""}</span>
      </div>
    ),
  },
  {
    id: "stay",
    header: "Stay",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="text-sm">
          {fmt(row.original.checkIn)} → {fmt(row.original.checkOut)}
        </span>
        <span className="text-muted-foreground text-xs">
          {STAY_TYPE_LABELS[row.original.stay_type]}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "quoted_total",
    header: "Total",
    cell: ({ row }) => (
      <span className="tabular-nums">{peso.format(Number(row.original.quoted_total))}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <BookingStatusBadge status={row.original.status as BookingStatus} />,
  },
  {
    accessorKey: "payment_status",
    header: "Payment",
    cell: ({ row }) => (
      <PaymentStatusBadge status={row.original.payment_status as "unpaid" | "partial" | "paid"} />
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <ManageAction booking={row.original} />,
  },
];

export function BookingsTable({ bookings }: { bookings: BookingRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={bookings}
      searchPlaceholder="Search by guest, ref, room…"
      emptyMessage="No bookings yet. Create a walk-in to get started."
      pageSize={12}
    />
  );
}
