import Link from "next/link";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoomVisual } from "./room-visual";
import { peso } from "@/features/bookings/pricing";
import type { AvailabilityOption } from "@/features/portal/repository";

export function RoomTypeCard({
  option,
  index,
  checkIn,
  checkOut,
}: {
  option: AvailabilityOption;
  index?: number;
  checkIn: string;
  checkOut: string;
}) {
  const soldOut = option.available <= 0;
  const bookHref = `/book?type=${option.id}&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}`;

  return (
    <article className="group border-border flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm ring-1 ring-black/[0.02] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl">
      <RoomVisual name={option.name} index={index} imageUrl={option.imageUrl} className="h-44" />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-[family-name:var(--font-fraunces)] text-lg font-semibold">
              {option.name}
            </h3>
            <p className="text-muted-foreground mt-0.5 inline-flex items-center gap-1 text-xs">
              <Users className="size-3.5" /> Sleeps up to {option.max_occupancy}
            </p>
          </div>
          {soldOut ? (
            <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
              Fully booked
            </span>
          ) : (
            <span className="rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/15">
              {option.available} left
            </span>
          )}
        </div>

        {option.description ? (
          <p className="text-muted-foreground line-clamp-2 text-sm">{option.description}</p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
          <div>
            <div className="text-muted-foreground text-xs">from</div>
            <div className="text-lg font-semibold">
              {peso.format(option.fromPrice)}
              <span className="text-muted-foreground text-xs font-normal"> / stay</span>
            </div>
          </div>
          {soldOut ? (
            <Button size="sm" disabled variant="outline">
              Unavailable
            </Button>
          ) : (
            <Button size="sm" nativeButton={false} render={<Link href={bookHref} />}>
              Book
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
