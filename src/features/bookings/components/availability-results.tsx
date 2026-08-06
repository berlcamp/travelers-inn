import { DoorClosed, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { peso } from "@/features/bookings/pricing";
import type { TypeAvailability } from "@/features/bookings/repository";
import type { RoomTypeWithTiers } from "@/features/rooms/repository";
import { WalkInDialog } from "./walk-in-dialog";

const dayTime = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const timeOnly = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" });

// A block that starts and ends the same day doesn't need the date twice.
function window(checkIn: Date, checkOut: Date): string {
  const sameDay = checkIn.toDateString() === checkOut.toDateString();
  return `${dayTime.format(checkIn)} → ${sameDay ? timeOnly.format(checkOut) : dayTime.format(checkOut)}`;
}

export function AvailabilityResults({
  results,
  roomTypes,
  checkIn,
  checkOut,
  guests,
}: {
  results: TypeAvailability[];
  roomTypes: RoomTypeWithTiers[];
  /** The searched window as datetime-local strings, handed to the book form. */
  checkIn: string;
  checkOut: string;
  guests: number;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {results.map((t) => {
        const free = t.freeRooms.length;
        return (
          <Card key={t.id} className={free === 0 ? "opacity-75" : undefined}>
            <CardHeader className="gap-1">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base">{t.name}</CardTitle>
                {!t.fits ? (
                  <Badge variant="outline">Max {t.max_occupancy} guests</Badge>
                ) : free > 0 ? (
                  <Badge variant="secondary">
                    {free} of {t.roomCount} free
                  </Badge>
                ) : (
                  <Badge variant="destructive">Fully booked</Badge>
                )}
              </div>
              <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3" /> Sleeps {t.base_occupancy}, max{" "}
                  {t.max_occupancy}
                </span>
                {t.excess_person_rate > 0 ? (
                  <span>· {peso.format(t.excess_person_rate)} per extra guest</span>
                ) : null}
                {t.outOfService > 0 ? (
                  <span>· {t.outOfService} out of service</span>
                ) : null}
              </p>
            </CardHeader>

            <CardContent className="flex flex-col gap-2">
              {t.tiers.length === 0 ? (
                <p className="text-muted-foreground text-sm">No active rate for this type.</p>
              ) : (
                t.tiers.map((tier) => {
                  const bookable = t.fits && tier.free > 0 && tier.price != null;
                  return (
                    <div
                      key={tier.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="text-sm font-medium">
                          {tier.unitLabel}
                          {tier.kind === "overnight" && tier.unitLabel !== tier.label ? (
                            <span className="text-muted-foreground font-normal">
                              {" "}
                              · {tier.label}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {window(tier.checkIn, tier.checkOut)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-sm font-semibold tabular-nums">
                            {tier.price != null ? peso.format(tier.price) : "—"}
                          </div>
                          <div
                            className={
                              tier.free > 0
                                ? "text-muted-foreground text-xs"
                                : "text-destructive text-xs"
                            }
                          >
                            {tier.free > 0 ? `${tier.free} free` : "none free"}
                          </div>
                        </div>
                        {bookable ? (
                          <WalkInDialog
                            roomTypes={roomTypes}
                            prefill={{
                              room_type_id: t.id,
                              rate_tier_id: tier.id,
                              guest_count: guests,
                              check_in: checkIn,
                              check_out: checkOut,
                            }}
                            trigger={
                              <Button size="sm" variant="outline">
                                Book
                              </Button>
                            }
                          />
                        ) : (
                          <Button size="sm" variant="outline" disabled>
                            Book
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {free > 0 ? (
                <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                  <DoorClosed className="size-3" />
                  Free rooms:
                  {t.freeRooms.map((r) => (
                    <span key={r.id} className="bg-muted rounded px-1.5 py-0.5 font-medium">
                      {r.label}
                    </span>
                  ))}
                </p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
