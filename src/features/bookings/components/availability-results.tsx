import { DoorClosed, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { peso } from "@/features/bookings/pricing";
import type { TypeAvailability } from "@/features/bookings/repository";
import type { RoomTypeWithTiers } from "@/features/rooms/repository";
import { cn } from "@/lib/utils";
import { WalkInDialog } from "./walk-in-dialog";
import { innFormatter } from "@/lib/inn-time";

const dayTime = innFormatter({
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const timeOnly = innFormatter({ hour: "numeric", minute: "2-digit" });

// A block that starts and ends the same day doesn't need the date twice.
function window(checkIn: Date, checkOut: Date): string {
  const sameDay = checkIn.toDateString() === checkOut.toDateString();
  return `${dayTime.format(checkIn)} → ${sameDay ? timeOnly.format(checkOut) : dayTime.format(checkOut)}`;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Can this type take the party at all, and is anything left to sell? */
export function sellable(t: TypeAvailability): boolean {
  return t.fits && t.tiers.some((tier) => tier.free > 0 && tier.price != null);
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
    // items-start, not stretch: a type with one rate beside a type with three
    // would otherwise be padded out with an empty half-card.
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {results.map((t) => {
        const free = t.freeRooms.length;
        const canSell = sellable(t);
        // The cheapest thing the desk could actually say yes to — the number a
        // clerk reads out loud when the phone asks "how much?".
        const from = Math.min(
          ...t.tiers.filter((x) => x.free > 0 && x.price != null).map((x) => x.price as number)
        );

        return (
          <Card
            key={t.id}
            className={cn(
              "flex flex-col gap-0 overflow-hidden py-0",
              // Unsellable types stay legible — they're dimmed by a flat header
              // and a muted body, not by fading the text a clerk still reads.
              !canSell && "bg-muted/25"
            )}
          >
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b p-4">
              <div className="min-w-0">
                <CardTitle className="text-base leading-tight">{t.name}</CardTitle>
                <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3" />
                    {t.base_occupancy === t.max_occupancy
                      ? plural(t.max_occupancy, "guest")
                      : `${t.base_occupancy}–${t.max_occupancy} guests`}
                  </span>
                  {t.excess_person_rate > 0 ? (
                    <span>· {peso.format(t.excess_person_rate)} per extra guest</span>
                  ) : null}
                  {t.outOfService > 0 ? <span>· {t.outOfService} out of service</span> : null}
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                {!t.fits ? (
                  <Badge variant="outline">Too small for {plural(guests, "guest")}</Badge>
                ) : free > 0 ? (
                  <Badge className="border-emerald-600/20 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                    {free} of {t.roomCount} free
                  </Badge>
                ) : (
                  <Badge variant="destructive">Fully booked</Badge>
                )}
                {canSell ? (
                  <span className="text-muted-foreground text-xs">
                    from <span className="text-foreground font-semibold">{peso.format(from)}</span>
                  </span>
                ) : null}
              </div>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col gap-2 p-4">
              {t.tiers.length === 0 ? (
                <p className="text-muted-foreground text-sm">No active rate for this type.</p>
              ) : !t.fits ? (
                // Every rate would price at "—" for a party this size, so the
                // rows would be a column of dashes next to dead buttons. Say
                // the one thing that would change the answer instead.
                <p className="text-muted-foreground text-sm">
                  Sleeps at most {plural(t.max_occupancy, "guest")}. Search{" "}
                  {plural(t.max_occupancy, "guest")} or fewer to book this type.
                </p>
              ) : (
                t.tiers.map((tier) => {
                  const bookable = t.fits && tier.free > 0 && tier.price != null;
                  return (
                    <div
                      key={tier.id}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 transition-colors",
                        bookable ? "bg-card hover:border-primary/30" : "border-dashed"
                      )}
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
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {window(tier.checkIn, tier.checkOut)}
                        </span>
                      </div>

                      <div className="ml-auto flex items-center gap-3">
                        <div className="text-right">
                          <div
                            className={cn(
                              "text-base leading-tight font-semibold tabular-nums",
                              !bookable && "text-muted-foreground"
                            )}
                          >
                            {tier.price != null ? peso.format(tier.price) : "—"}
                          </div>
                          {/* The count is what decides the sale, so it carries a
                              dot as well as a colour — colour alone would say
                              nothing to a colour-blind clerk. */}
                          <div className="text-muted-foreground flex items-center justify-end gap-1 text-xs">
                            <span
                              aria-hidden
                              className={cn(
                                "size-1.5 rounded-full",
                                tier.free > 0 ? "bg-emerald-500" : "bg-muted-foreground/40"
                              )}
                            />
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
                            trigger={<Button size="sm">Book</Button>}
                          />
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled
                            title="No room of this type is free for that window"
                          >
                            Book
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {free > 0 ? (
                <p className="text-muted-foreground mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                  <DoorClosed className="size-3" />
                  Free rooms:
                  {t.freeRooms.map((r) => (
                    <span
                      key={r.id}
                      className="bg-muted rounded px-1.5 py-0.5 font-medium tabular-nums"
                    >
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
