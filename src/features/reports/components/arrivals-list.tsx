"use client";

import { Button } from "@/components/ui/button";
import { BookingManageDialog } from "@/features/bookings/components/booking-manage-dialog";
import type { RptBooking } from "@/features/reports/reports";

const timeFmt = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" });
function time(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : timeFmt.format(d);
}

export function ArrivalsList({
  bookings,
  timeField,
  emptyText,
}: {
  bookings: RptBooking[];
  timeField: "checkIn" | "checkOut";
  emptyText: string;
}) {
  if (bookings.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">{emptyText}</p>;
  }
  return (
    <ul className="divide-border divide-y">
      {bookings.map((b) => (
        <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="flex flex-col">
            <span className="font-medium">{b.guestName}</span>
            <span className="text-muted-foreground text-xs">
              Room {b.roomLabel} · {b.roomTypeName} · {time(b[timeField])}
            </span>
          </div>
          <BookingManageDialog
            bookingId={b.id}
            trigger={
              <Button variant="outline" size="sm">
                Manage
              </Button>
            }
          />
        </li>
      ))}
    </ul>
  );
}
