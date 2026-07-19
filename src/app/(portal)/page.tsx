import type { Metadata } from "next";
import { Clock, MapPin, ShieldCheck } from "lucide-react";
import { SearchBar } from "@/features/portal/components/search-bar";
import { RoomTypeCard } from "@/features/portal/components/room-type-card";
import { listPortalAvailability } from "@/features/portal/repository";
import type { StayType } from "@/features/bookings/pricing";

export const metadata: Metadata = {
  title: "Book your stay",
  description: "Comfortable rooms at Bañares Traveler's Inn — book in seconds, any hour of the day.",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function localToISO(local: string): string {
  return new Date(local).toISOString();
}
function defaultWindow() {
  const ci = new Date();
  ci.setHours(14, 0, 0, 0);
  const co = new Date(ci);
  co.setDate(co.getDate() + 1);
  co.setHours(12, 0, 0, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { checkIn: fmt(ci), checkOut: fmt(co) };
}

export default async function PortalHome({
  searchParams,
}: {
  searchParams: Promise<{ checkIn?: string; checkOut?: string; stay?: string }>;
}) {
  const sp = await searchParams;
  const searched = Boolean(sp.checkIn && sp.checkOut);
  const stay: StayType = sp.stay === "hourly" ? "hourly" : "nightly";

  const win = searched ? { checkIn: sp.checkIn!, checkOut: sp.checkOut! } : defaultWindow();
  const options = await listPortalAvailability(
    localToISO(win.checkIn),
    localToISO(win.checkOut),
    stay
  );

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[oklch(0.95_0.03_75)] to-[oklch(0.985_0.008_85)] dark:from-[oklch(0.24_0.03_65)] dark:to-[oklch(0.18_0.015_70)]" />
        <div className="absolute -left-24 top-10 -z-10 size-72 rounded-full bg-[oklch(0.78_0.13_65)]/20 blur-3xl" />
        <div className="absolute -right-16 top-32 -z-10 size-72 rounded-full bg-[oklch(0.5_0.09_185)]/15 blur-3xl" />

        <div className="mx-auto w-full max-w-6xl px-5 pb-10 pt-16 sm:pt-24">
          <p className="text-primary mb-3 text-sm font-medium uppercase tracking-[0.2em]">
            Rest easy, arrive anytime
          </p>
          <h1 className="font-[family-name:var(--font-fraunces)] max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            A warm room waiting,{" "}
            <span className="text-primary italic">whenever</span> you travel.
          </h1>
          <p className="text-muted-foreground mt-5 max-w-lg text-lg">
            Nightly stays and short day-use rooms. Check availability, book in seconds — pay at the
            front desk when you arrive.
          </p>

          <div className="mt-8 max-w-3xl">
            <SearchBar defaults={{ checkIn: sp.checkIn, checkOut: sp.checkOut, stay }} />
          </div>

          <div className="text-muted-foreground mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-4" /> 24-hour front desk
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-4" /> Instant confirmation
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" /> Pay on arrival
            </span>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold">
            {searched ? "Available for your dates" : "Our rooms"}
          </h2>
          <span className="text-muted-foreground text-sm">
            {options.length} room {options.length === 1 ? "type" : "types"}
          </span>
        </div>

        {options.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-10 text-center">
            No rooms match that search. Try different dates.
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {options.map((option, i) => (
              <RoomTypeCard
                key={option.id}
                option={option}
                index={i}
                checkIn={win.checkIn}
                checkOut={win.checkOut}
                stay={stay}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
