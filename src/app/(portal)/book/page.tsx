import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalBookingForm } from "@/features/portal/components/portal-booking-form";
import { RoomGallery } from "@/features/portal/components/room-gallery";
import {
  getPortalPaymentInfo,
  getRoomTypePublic,
  listPortalAvailability,
} from "@/features/portal/repository";
import { peso } from "@/features/bookings/pricing";
import { SITE_URL } from "@/lib/site";
import { coverOgImage, fallbackOgImage } from "@/lib/og-image";

type BookSearchParams = { type?: string; checkIn?: string; checkOut?: string };

const FALLBACK_DESCRIPTION =
  "Reserve with a small deposit and settle the rest at the front desk when you arrive.";

// A room link shared to Facebook should show THAT room, not the inn's generic
// card. Page-level `openGraph` replaces the root layout's wholesale rather than
// merging field by field, so every field is restated here — omitting one blanks
// it rather than inheriting it.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<BookSearchParams>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const roomType = sp.type ? await getRoomTypePublic(sp.type) : null;

  if (!roomType) return { title: "Complete your booking" };

  const title = roomType.name;
  const description = roomType.description?.trim() || FALLBACK_DESCRIPTION;

  // `image_url` is the cover — migration 20260726000100 keeps it synced to the
  // lowest-sort_order photo — and Supabase's getPublicUrl already made it
  // absolute, which is what crawlers require. coverOgImage additionally sizes
  // it to 1200×630 so the DIMENSIONS can be declared: without those Facebook
  // draws the card before it has measured the file, and since every shared
  // link carries the sharer's own dates, every share is a first scrape and
  // every card came out with no thumbnail. See lib/og-image.ts.
  const images = [
    coverOgImage(roomType.image_url, `${roomType.name} · Bañares Traveler's Inn`) ??
      fallbackOgImage(),
  ];

  // og:url keeps the dates the sharer had. Facebook follows it on click, and a
  // /book URL stripped of its dates renders "that room could not be found" —
  // so trimming them for tidier cache keys would break the click-through.
  const canonical = new URL("/book", SITE_URL);
  for (const [key, value] of Object.entries(sp)) {
    if (value) canonical.searchParams.set(key, value);
  }

  return {
    title,
    description,
    openGraph: {
      type: "website",
      url: canonical.toString(),
      siteName: "Bañares Traveler's Inn",
      title: `${title} · Bañares Traveler's Inn`,
      description,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} · Bañares Traveler's Inn`,
      description,
      images: images.map((i) => i.url),
    },
  };
}

const dtFmt = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
  month: "short",
  day: "numeric",
});
function fmtDate(local: string) {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "—" : dtFmt.format(d);
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<BookSearchParams>;
}) {
  const sp = await searchParams;
  const roomType = sp.type ? await getRoomTypePublic(sp.type) : null;

  if (!roomType || !sp.checkIn || !sp.checkOut) {
    return <Unavailable message="That room could not be found. Let's find you another." />;
  }

  const options = await listPortalAvailability(
    new Date(sp.checkIn).toISOString(),
    new Date(sp.checkOut).toISOString()
  );
  const option = options.find((o) => o.id === roomType.id);

  // Only bail out for a genuinely unbookable room (bad link / no rates). Do NOT
  // gate on availability here: a successful booking triggers a server-action
  // refresh of this route, and gating would replace the confirmation screen
  // with "sold out". Availability is surfaced inside the form instead.
  if (!option || option.tiers.length === 0) {
    return <Unavailable message="That room could not be found. Let's find you another." />;
  }

  const payment = await getPortalPaymentInfo();
  const stayLabel = `${fmtDate(sp.checkIn)} → ${fmtDate(sp.checkOut)}`;

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={<Link href="/" />}
        className="text-muted-foreground mb-6 -ml-2"
      >
        <ArrowLeft className="size-4" /> Back to rooms
      </Button>

      <div className="grid gap-8 md:grid-cols-[1fr_1.1fr]">
        {/* Summary */}
        <div className="border-border bg-card flex flex-col overflow-hidden rounded-2xl border">
          <div className="p-3 pb-0">
            <RoomGallery name={option.name} photos={option.photos} />
          </div>
          <div className="flex flex-col gap-4 p-6">
            <h1 className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold">
              {option.name}
            </h1>
            <div className="text-muted-foreground flex items-start gap-2 text-sm">
              <CalendarDays className="mt-0.5 size-4 shrink-0" />
              <span>{stayLabel}</span>
            </div>
            <div className="text-muted-foreground flex items-start gap-2 text-sm">
              <Users className="mt-0.5 size-4 shrink-0" />
              <span>
                Sleeps up to {option.max_occupancy}
                {option.excess_person_rate > 0
                  ? ` · ${peso.format(option.excess_person_rate)}/head beyond ${option.base_occupancy}`
                  : ""}
              </span>
            </div>
            <div className="border-border/70 flex items-center justify-between border-t pt-4">
              <div>
                <div className="text-muted-foreground text-xs">from</div>
                <div className="text-2xl font-semibold">{peso.format(option.fromPrice)}</div>
              </div>
              {option.available > 0 ? (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  {option.available} available
                </span>
              ) : (
                <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
                  Fully booked
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-4">
          <h2 className="font-[family-name:var(--font-fraunces)] text-xl font-semibold">
            Your stay &amp; details
          </h2>
          <PortalBookingForm
            option={option}
            roomTypeName={option.name}
            checkIn={sp.checkIn}
            checkOut={sp.checkOut}
            payment={payment}
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
