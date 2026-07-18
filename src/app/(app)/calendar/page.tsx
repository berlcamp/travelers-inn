import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, DoorOpen } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { listRoomsWithType } from "@/features/rooms/repository";
import { listBookings } from "@/features/bookings/repository";
import { buildCalendar } from "@/features/bookings/calendar";
import { CalendarGrid } from "@/features/bookings/components/calendar-grid";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Calendar" };

const DAYS = 14;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  await requireRole(["admin", "front_desk"]);
  const { start } = await searchParams;

  const [rooms, bookings] = await Promise.all([listRoomsWithType(), listBookings()]);
  const data = buildCalendar(start ?? "", DAYS, rooms, bookings);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Calendar"
        description={`Room availability across ${DAYS} days.`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              nativeButton={false}
              render={<Link href={`/calendar?start=${data.prevISO}`} aria-label="Previous" />}
            >
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/calendar" />}>
              Today
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              nativeButton={false}
              render={<Link href={`/calendar?start=${data.nextISO}`} aria-label="Next" />}
            >
              <ChevronRight />
            </Button>
          </div>
        }
      />

      {rooms.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title="No rooms yet"
          description="Add rooms first — the calendar shows their occupancy."
        />
      ) : (
        <>
          <CalendarGrid data={data} />
          <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="bg-primary/20 inline-block size-3 rounded" /> Confirmed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3 rounded bg-emerald-500/25" /> Checked in
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="bg-muted-foreground/15 inline-block size-3 rounded" /> Checked out
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3" /> {data.startISO}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
