"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

export function AvailabilitySearch({
  checkIn,
  checkOut,
  guests,
}: {
  checkIn: string;
  checkOut: string;
  guests: number;
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

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="in" className="text-muted-foreground text-xs">
          Arrival
        </label>
        <Input
          id="in"
          type="datetime-local"
          className="w-52"
          value={draftIn}
          onChange={(e) => setDraftIn(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="out" className="text-muted-foreground text-xs">
          Departure
        </label>
        <Input
          id="out"
          type="datetime-local"
          className="w-52"
          value={draftOut}
          onChange={(e) => setDraftOut(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="guests" className="text-muted-foreground text-xs">
          Guests
        </label>
        <Input
          id="guests"
          type="number"
          min={1}
          max={50}
          className="w-20"
          value={draftGuests}
          onChange={(e) => setDraftGuests(e.target.value)}
        />
      </div>
      <Button disabled={pending} onClick={() => apply(draftIn, draftOut, draftGuests)}>
        <Search className="size-4" />
        {pending ? "Checking…" : "Check"}
      </Button>

      <div className="flex flex-wrap gap-1.5">
        {presets().map((p) => (
          <Button
            key={p.label}
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => apply(localDateTime(p.checkIn), localDateTime(p.checkOut), draftGuests)}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
