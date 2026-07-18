import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalBookingForm } from "@/features/portal/components/portal-booking-form";
import { RoomVisual } from "@/features/portal/components/room-visual";
import { getRoomTypePublic, listPortalAvailability } from "@/features/portal/repository";
import { peso, type StayType } from "@/features/bookings/pricing";

export const metadata: Metadata = { title: "Complete your booking" };

const dtFmt = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
function fmt(local: string) {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "—" : dtFmt.format(d);
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; checkIn?: string; checkOut?: string; stay?: string }>;
}) {
  const sp = await searchParams;
  const stay: StayType = sp.stay === "hourly" ? "hourly" : "nightly";

  const roomType = sp.type ? await getRoomTypePublic(sp.type) : null;

  if (!roomType || !sp.checkIn || !sp.checkOut) {
    return <Unavailable message="That room could not be found. Let's find you another." />;
  }

  const options = await listPortalAvailability(
    new Date(sp.checkIn).toISOString(),
    new Date(sp.checkOut).toISOString(),
    stay
  );
  const option = options.find((o) => o.id === roomType.id);

  if (!option || option.available <= 0 || option.priceError) {
    return (
      <Unavailable message="Sorry — that room just booked out for your dates. Try another room or time." />
    );
  }

  const stayLabel = `${fmt(sp.checkIn)} → ${fmt(sp.checkOut)}`;

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={<Link href="/" />}
        className="text-muted-foreground -ml-2 mb-6"
      >
        <ArrowLeft className="size-4" /> Back to rooms
      </Button>

      <div className="grid gap-8 md:grid-cols-[1fr_1.1fr]">
        {/* Summary */}
        <div className="border-border bg-card flex flex-col overflow-hidden rounded-2xl border">
          <RoomVisual name={option.name} className="h-40" />
          <div className="flex flex-col gap-4 p-6">
            <h1 className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold">
              {option.name}
            </h1>
            <div className="text-muted-foreground flex items-start gap-2 text-sm">
              <CalendarDays className="mt-0.5 size-4 shrink-0" />
              <span>{stayLabel}</span>
            </div>
            <div className="border-border/70 flex items-center justify-between border-t pt-4">
              <div>
                <div className="text-muted-foreground text-xs">
                  {option.units} {option.unitLabel}
                </div>
                <div className="text-2xl font-semibold">{peso.format(option.total)}</div>
              </div>
              <span className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 rounded-full px-2.5 py-1 text-xs font-medium">
                {option.available} available
              </span>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-4">
          <h2 className="font-[family-name:var(--font-fraunces)] text-xl font-semibold">
            Your details
          </h2>
          <PortalBookingForm
            roomTypeId={option.id}
            roomTypeName={option.name}
            stay={stay}
            checkIn={sp.checkIn}
            checkOut={sp.checkOut}
            stayLabel={stayLabel}
          />
        </div>
      </div>
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-5 py-24 text-center">
      <h1 className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold">Oh no</h1>
      <p className="text-muted-foreground">{message}</p>
      <Button nativeButton={false} render={<Link href="/" />}>
        Search rooms
      </Button>
    </div>
  );
}
