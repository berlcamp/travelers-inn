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
      <section className="relative overflow-hidden bg-white">
        {/* Fine dot-grid texture + soft brand glows — subtle depth on white, no heavy blobs. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-[0.5] [background-image:radial-gradient(circle_at_1px_1px,oklch(0.5_0.03_185)_1px,transparent_0)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div
          aria-hidden
          className="absolute -right-32 -top-24 -z-10 size-[30rem] rounded-full bg-[oklch(0.78_0.13_65)]/10 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -left-40 top-24 -z-10 size-[26rem] rounded-full bg-[oklch(0.5_0.09_185)]/10 blur-3xl"
        />

        <div className="mx-auto w-full max-w-6xl px-5 pb-14 pt-16 sm:px-8 sm:pt-24">
          <p className="mb-4 inline-flex items-center gap-2 text-sm font-medium uppercase tracking-[0.22em] text-[oklch(0.5_0.09_60)]">
            <span className="h-px w-8 bg-[oklch(0.62_0.13_55)]" />
            Rest easy, arrive anytime
          </p>
          <h1 className="font-[family-name:var(--font-fraunces)] max-w-3xl text-[2.75rem] font-semibold leading-[1.03] tracking-tight text-[oklch(0.22_0.02_60)] sm:text-6xl">
            A warm room waiting,{" "}
            <span className="text-primary italic">whenever</span> you travel.
          </h1>
          <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-relaxed">
            Nightly stays and short day-use rooms in the heart of town. Check availability, book in
            seconds — and pay at the front desk when you arrive.
          </p>

          <div className="mt-9 max-w-3xl">
            <SearchBar defaults={{ checkIn: sp.checkIn, checkOut: sp.checkOut, stay }} />
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            {[
              { icon: Clock, label: "24-hour front desk" },
              { icon: ShieldCheck, label: "Instant confirmation" },
              { icon: MapPin, label: "Pay on arrival" },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="text-foreground/80 inline-flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-[oklch(0.42_0.07_185)]/8 text-primary">
                  <Icon className="size-3.5" />
                </span>
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
        <div className="mb-8 flex items-end justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 className="font-[family-name:var(--font-fraunces)] text-3xl font-semibold tracking-tight">
              {searched ? "Available for your dates" : "Our rooms"}
            </h2>
            <p className="text-muted-foreground mt-1.5 text-sm">
              {searched
                ? "Choose a room and reserve it in a couple of taps."
                : "Thoughtfully kept rooms for every kind of traveler."}
            </p>
          </div>
          <span className="text-muted-foreground shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium">
            {options.length} room {options.length === 1 ? "type" : "types"}
          </span>
        </div>

        {options.length === 0 ? (
          <p className="text-muted-foreground rounded-2xl border border-dashed border-border p-12 text-center">
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
