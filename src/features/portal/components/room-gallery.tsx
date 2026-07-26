"use client";

import { useState } from "react";
import { RoomVisual } from "./room-visual";

// Main image + thumbnail strip — the familiar hotel-booking pattern. Falls
// back to the gradient RoomVisual when a type has no photos, so nothing
// regresses for types that were never given images.
export function RoomGallery({
  name,
  photos,
  className,
}: {
  name: string;
  photos: { url: string }[];
  className?: string;
}) {
  const [active, setActive] = useState(0);

  if (photos.length === 0) {
    // Matches the rounded-xl on the photo path below (the ".bg-muted
    // ...rounded-xl" image wrapper) — this used to sit flush inside the
    // card's own overflow-hidden rounded-2xl, but now renders inside a
    // padded wrapper (p-3 pb-0 in book/page.tsx), so it needs its own
    // rounding or it shows a sharp-cornered block. Seed data ships no
    // photos, so this is the fallback every room type actually hits.
    return <RoomVisual name={name} className={className ?? "h-56 rounded-xl"} />;
  }

  const current = photos[Math.min(active, photos.length - 1)];

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-muted relative overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={`${name} — photo ${active + 1} of ${photos.length}`}
          className="h-56 w-full object-cover sm:h-64"
        />
      </div>

      {photos.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((photo, i) => (
            <button
              type="button"
              key={photo.url}
              onClick={() => setActive(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === active}
              className={`size-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                i === active ? "border-primary" : "border-transparent hover:border-foreground/20"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
