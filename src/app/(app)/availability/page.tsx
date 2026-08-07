import type { Metadata } from "next";
import { BedDouble, Search } from "lucide-react";
import { pageRole } from "@/lib/auth/guards";
import { AccessDenied } from "@/components/shared/access-denied";
import { searchAvailability } from "@/features/bookings/repository";
import { listActiveRoomTypes } from "@/features/rooms/repository";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { AvailabilitySearch } from "@/features/bookings/components/availability-search";
import { AvailabilityResults } from "@/features/bookings/components/availability-results";

export const metadata: Metadata = { title: "Availability" };

const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const windowFmt = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function localDateTime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Noon the day after arrival — the inn's standard check-out, and the window an
// unqualified "do you have a room?" means.
function nextNoon(after: Date): Date {
  const out = new Date(after);
  out.setDate(out.getDate() + 1);
  out.setHours(12, 0, 0, 0);
  if (out.getTime() <= after.getTime()) out.setDate(out.getDate() + 1);
  return out;
}

// Everything the page shows comes from the URL, so a search can be reloaded,
// shared or kept open on a second tab while the desk takes another call.
function resolveWindow(inRaw?: string, outRaw?: string) {
  const now = new Date();
  const fallbackIn = new Date(now);
  // Before the 1pm standard arrival "today" still means 1pm; after it, a guest
  // asking now arrives now — which also keeps an overnight quote at 1 night.
  if (now.getHours() < 13) fallbackIn.setHours(13, 0, 0, 0);
  fallbackIn.setSeconds(0, 0);

  const checkIn = inRaw && DT_RE.test(inRaw) ? new Date(inRaw) : fallbackIn;
  const parsedOut = outRaw && DT_RE.test(outRaw) ? new Date(outRaw) : null;
  // A backwards or equal window would report nothing free for reasons that
  // look like a system fault; fall back to the standard overnight instead.
  const checkOut =
    parsedOut && parsedOut.getTime() > checkIn.getTime() ? parsedOut : nextNoon(checkIn);
  return { checkIn, checkOut };
}

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ in?: string; out?: string; guests?: string }>;
}) {
  const allowed = await pageRole(["admin", "front_desk"]);
  if (!allowed) return <AccessDenied requires={["admin", "front_desk"]} />;
  const { in: inRaw, out: outRaw, guests: guestsRaw } = await searchParams;

  const { checkIn, checkOut } = resolveWindow(inRaw, outRaw);
  const guests = Math.min(50, Math.max(1, Number(guestsRaw) || 2));

  const [results, roomTypes] = await Promise.all([
    searchAvailability(checkIn, checkOut, guests),
    listActiveRoomTypes(),
  ]);

  const freeRooms = results.reduce((sum, t) => sum + t.freeRooms.length, 0);
  const totalRooms = results.reduce((sum, t) => sum + t.roomCount, 0);
  const anyBookable = results.some(
    (t) => t.fits && t.tiers.some((tier) => tier.free > 0 && tier.price != null)
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Availability"
        description="Answer a walk-in or a phone inquiry: what's free, what it costs, book it on the spot."
      />

      <AvailabilitySearch
        checkIn={localDateTime(checkIn)}
        checkOut={localDateTime(checkOut)}
        guests={guests}
      />

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
        <span className="text-foreground font-medium">
          {freeRooms} of {totalRooms} room{totalRooms === 1 ? "" : "s"} free
        </span>
        <span>
          · {windowFmt.format(checkIn)} → {windowFmt.format(checkOut)}
        </span>
        <span>
          · {guests} guest{guests === 1 ? "" : "s"}
        </span>
      </div>

      {results.length === 0 ? (
        <EmptyState
          icon={BedDouble}
          title="No room types yet"
          description="Add a room type with a rate before checking availability."
        />
      ) : (
        <>
          {!anyBookable ? (
            <EmptyState
              icon={Search}
              title="Nothing free for that window"
              description={`No room type can take ${guests} guest${guests === 1 ? "" : "s"} then. Try another date, a shorter block, or fewer guests — the rooms below show what is booked.`}
            />
          ) : null}
          <AvailabilityResults
            results={results}
            roomTypes={roomTypes}
            checkIn={localDateTime(checkIn)}
            checkOut={localDateTime(checkOut)}
            guests={guests}
          />
        </>
      )}
    </div>
  );
}
