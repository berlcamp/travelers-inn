"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DataTable, includesValue } from "@/components/shared/data-table";
import { BookingStatusBadge, PaymentStatusBadge } from "./booking-status-badge";
import { BookingManageDialog } from "./booking-manage-dialog";
import { peso } from "@/features/bookings/pricing";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type BookingStatus,
} from "@/features/bookings/schemas";
import { BOOKING_SOURCE_LABELS } from "@/features/bookings/trail";
import type { BookingRow } from "@/features/bookings/repository";
import { innFormatter } from "@/lib/inn-time";

const dt = innFormatter({
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function fmt(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dt.format(d);
}

function ManageAction({ booking, canDelete }: { booking: BookingRow; canDelete: boolean }) {
  return (
    <div className="flex justify-end">
      <BookingManageDialog
        bookingId={booking.id}
        canDelete={canDelete}
        trigger={
          <Button variant="outline" size="sm">
            Manage
          </Button>
        }
      />
    </div>
  );
}

// A factory rather than a module-level const because the last column has to
// know whether this user may delete. Memoised at the call site — new column
// identities on every render would reset the table's sorting and filters.
const makeColumns = (canDelete: boolean): ColumnDef<BookingRow>[] => [
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
          {row.original.rate_tier?.label ?? "—"} · {row.original.guest_count} guest
          {row.original.guest_count === 1 ? "" : "s"}
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
    id: "handled_by",
    header: "Handled by",
    // Searchable by staff name: "which walk-ins did Dana take?" is the whole
    // point of showing this column. Portal bookings have no creator — the guest
    // made them — so they show the channel and, once verified, the verifier.
    accessorFn: (row) =>
      `${row.createdByName ?? ""} ${row.verifiedByName ?? ""} ${row.source}`.trim(),
    cell: ({ row }) => {
      const b = row.original;
      return (
        <div className="flex flex-col">
          <span className="text-sm">
            {b.createdByName ?? (b.source === "portal" ? "Guest (online)" : "—")}
          </span>
          <span className="text-muted-foreground text-xs">
            {BOOKING_SOURCE_LABELS[b.source] ?? b.source}
            {b.verifiedByName ? ` · verified by ${b.verifiedByName}` : ""}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    filterFn: includesValue,
    cell: ({ row }) => <BookingStatusBadge status={row.original.status as BookingStatus} />,
  },
  {
    accessorKey: "payment_status",
    header: "Payment",
    filterFn: includesValue,
    cell: ({ row }) => (
      <PaymentStatusBadge status={row.original.payment_status as "unpaid" | "partial" | "paid"} />
    ),
  },
  // Filter-only: the channel is already spelled out under "Handled by", so a
  // column of its own would repeat it. Hidden columns still filter.
  { accessorKey: "source", header: "Channel", filterFn: includesValue },
  // Also filter-only, and separate from the visible "Room" column above on
  // purpose: that one's accessor is "101 Standard" so the search box matches
  // either the number or the type, which makes it useless as a facet — the
  // chips would read "101 Standard". This one is the bare label, so the filter
  // lists room numbers and nothing else.
  {
    id: "room_label",
    header: "Room",
    accessorFn: (row) => row.room?.label ?? "",
    filterFn: includesValue,
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <ManageAction booking={row.original} canDelete={canDelete} />,
  },
];

const STATUS_OPTIONS = BOOKING_STATUSES.map((s) => ({
  value: s,
  label: BOOKING_STATUS_LABELS[s],
}));

const PAYMENT_OPTIONS = (["unpaid", "partial", "paid"] as const).map((s) => ({
  value: s,
  label: PAYMENT_STATUS_LABELS[s],
}));

const CHANNEL_OPTIONS = Object.entries(BOOKING_SOURCE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function BookingsTable({
  bookings,
  canDelete = false,
}: {
  bookings: BookingRow[];
  canDelete?: boolean;
}) {
  const columns = useMemo(() => makeColumns(canDelete), [canDelete]);
  // Unlike status/payment/channel, the rooms aren't a fixed enum — they're
  // whatever the inn has, so the options come from the rows on screen. A room
  // with no bookings yet has nothing to filter to, and offering it would be an
  // option that always returns an empty table.
  //
  // Sorted numerically: labels are "101", "102", "201", and a plain string
  // sort puts "1010" between "101" and "102" the day the inn adds a floor.
  const roomOptions = useMemo(() => {
    const labels = [...new Set(bookings.map((b) => b.room?.label).filter(Boolean) as string[])];
    return labels
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((label) => ({ value: label, label }));
  }, [bookings]);

  return (
    <DataTable
      columns={columns}
      data={bookings}
      searchPlaceholder="Search by guest, ref, room…"
      filterableColumns={[
        { id: "status", title: "Status", options: STATUS_OPTIONS },
        { id: "payment_status", title: "Payment", options: PAYMENT_OPTIONS },
        { id: "room_label", title: "Room", options: roomOptions },
        { id: "source", title: "Channel", options: CHANNEL_OPTIONS },
      ]}
      initialColumnVisibility={{ source: false, room_label: false }}
      emptyMessage="No bookings yet. Create a walk-in to get started."
    />
  );
}
