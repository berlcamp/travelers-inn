import Link from "next/link";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoomVisual } from "./room-visual";
import { peso } from "@/features/bookings/pricing";
import type { AvailabilityOption } from "@/features/portal/repository";

export function RoomTypeCard({
  option,
  checkIn,
  checkOut,
  stay,
}: {
  option: AvailabilityOption;
  checkIn: string;
  checkOut: string;
  stay: "nightly" | "hourly";
}) {
  const soldOut = option.available <= 0;
  const bookHref = `/book?type=${option.id}&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}&stay=${stay}`;
  const rateLabel =
    stay === "hourly"
      ? `${peso.format(option.hourlyRate ?? 0)} / hour`
      : `${peso.format(option.nightlyRate)} / night`;

  return (
    <article className="group border-border/70 bg-card flex flex-col overflow-hidden rounded-2xl border transition-shadow hover:shadow-lg">
      <RoomVisual name={option.name} className="h-40" />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-[family-name:var(--font-fraunces)] text-lg font-semibold">
              {option.name}
            </h3>
            <p className="text-muted-foreground mt-0.5 inline-flex items-center gap-1 text-xs">
              <Users className="size-3.5" /> Sleeps {option.capacity}
            </p>
          </div>
          {soldOut ? (
            <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
              Fully booked
            </span>
          ) : (
            <span className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 rounded-full px-2.5 py-1 text-xs font-medium">
              {option.available} left
            </span>
          )}
        </div>

        {option.description ? (
          <p className="text-muted-foreground line-clamp-2 text-sm">{option.description}</p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
          <div>
            <div className="text-muted-foreground text-xs">{rateLabel}</div>
            <div className="text-lg font-semibold">
              {peso.format(option.total)}
              <span className="text-muted-foreground text-xs font-normal">
                {" "}
                / {option.units} {option.unitLabel}
              </span>
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
