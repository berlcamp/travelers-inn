"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// "YYYY-MM-DDTHH:mm" in local wall-clock — what datetime-local inputs speak and
// what the booking actions read back (single-location inn, server local zone).
function localDateTime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function at(daysFromToday: number, hours: number, minutes = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

// The three windows the desk is asked about all day. Computed from the
// browser's clock at click time; the page itself renders from the URL, so a
// search is always shareable and survives a reload.
function presets(): { label: string; checkIn: Date; checkOut: Date }[] {
  const now = new Date();
  // Before the 1pm standard arrival, "tonight" still means 1pm today; after
  // it, a guest asking now arrives now.
  const tonightIn = now.getHours() >= 13 ? now : at(0, 13);
  return [
    { label: "Tonight", checkIn: tonightIn, checkOut: at(1, 12) },
    { label: "Tomorrow night", checkIn: at(1, 13), checkOut: at(2, 12) },
    { label: "Next weekend", checkIn: nextFriday(13), checkOut: nextSunday(12) },
  ];
}

function nextFriday(hours: number): Date {
  const d = new Date();
  // 5 = Friday. Always look ahead, so on a Friday this means the next one.
  const ahead = ((5 - d.getDay() + 7) % 7) || 7;
  return at(ahead, hours);
}

function nextSunday(hours: number): Date {
  const d = new Date();
  const friday = ((5 - d.getDay() + 7) % 7) || 7;
  return at(friday + 2, hours);
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
    >
      {children}
    </label>
  );
}

export function AvailabilitySearch({
  checkIn,
  checkOut,
  guests,
  summary,
}: {
  checkIn: string;
  checkOut: string;
  guests: number;
  /** The result line, rendered inside this panel's footer rule. */
  summary?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draftIn, setDraftIn] = useState(checkIn);
  const [draftOut, setDraftOut] = useState(checkOut);
  const [draftGuests, setDraftGuests] = useState(String(guests));

  function apply(nextIn: string, nextOut: string, nextGuests: string) {
    const heads = Math.min(50, Math.max(1, Number(nextGuests) || 1));
    setDraftIn(nextIn);
    setDraftOut(nextOut);
    setDraftGuests(String(heads));
    startTransition(() =>
      router.push(
        `/availability?in=${encodeURIComponent(nextIn)}&out=${encodeURIComponent(nextOut)}&guests=${heads}`
      )
    );
  }

  // A preset is "on" when the window on screen is the one it would set. Both
  // sides are wall-clock strings, so this is a plain comparison — except
  // Tonight, whose arrival is `now` after 1pm and so drifts by the minute.
  const activePreset = presets().find(
    (p) => localDateTime(p.checkIn) === checkIn && localDateTime(p.checkOut) === checkOut
  )?.label;

  return (
    <div className="border-border/60 bg-card rounded-xl border shadow-sm">
      <form
        // Enter anywhere in the panel runs the search: the desk types a date
        // and expects an answer without reaching for the mouse.
        onSubmit={(e) => {
          e.preventDefault();
          apply(draftIn, draftOut, draftGuests);
        }}
        className="flex flex-col gap-4 p-4"
      >
        {/* Flex rather than a grid: the two datetimes want the slack and the
            guest count and button want only what they need, which grid
            fractions can't express without fixing every column. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex min-w-52 flex-1 flex-col gap-1.5">
            <FieldLabel htmlFor="in">Arrival</FieldLabel>
            <Input
              id="in"
              type="datetime-local"
              value={draftIn}
              onChange={(e) => setDraftIn(e.target.value)}
            />
          </div>
          <div className="flex min-w-52 flex-1 flex-col gap-1.5">
            <FieldLabel htmlFor="out">Departure</FieldLabel>
            <Input
              id="out"
              type="datetime-local"
              value={draftOut}
              onChange={(e) => setDraftOut(e.target.value)}
            />
          </div>
          <div className="flex w-full flex-col gap-1.5 sm:w-24">
            <FieldLabel htmlFor="guests">Guests</FieldLabel>
            <Input
              id="guests"
              type="number"
              min={1}
              max={50}
              value={draftGuests}
              onChange={(e) => setDraftGuests(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            <Search className="size-4" />
            {pending ? "Checking…" : "Check"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground mr-0.5 inline-flex items-center gap-1.5 text-xs">
            <CalendarClock className="size-3.5" />
            Quick windows
          </span>
          {presets().map((p) => {
            const active = activePreset === p.label;
            return (
              <Button
                key={p.label}
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                aria-pressed={active}
                className={cn(
                  active && "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                )}
                onClick={() =>
                  apply(localDateTime(p.checkIn), localDateTime(p.checkOut), draftGuests)
                }
              >
                {p.label}
              </Button>
            );
          })}
        </div>
      </form>

      {summary ? (
        <div className="border-border/60 text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-3 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5" />
            {guests} guest{guests === 1 ? "" : "s"}
          </span>
          {summary}
        </div>
      ) : null}
    </div>
  );
}
