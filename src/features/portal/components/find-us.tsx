import { MapPin, Navigation } from "lucide-react";
import { isSet } from "@/features/settings/schemas";

// A plain google.com/maps embed — deliberately NOT the official Maps Embed API,
// which needs an API key and a billing account. Renders nothing until an admin
// has set the coordinates at /settings, so an unconfigured install degrades
// quietly instead of showing a map of nowhere.
export function FindUs({
  address,
  lat,
  lng,
}: {
  address: string;
  lat: string;
  lng: string;
}) {
  if (!isSet(lat) || !isSet(lng)) return null;

  const coords = `${lat},${lng}`;
  const embedSrc = `https://www.google.com/maps?q=${encodeURIComponent(coords)}&z=17&output=embed`;
  const directionsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coords)}`;

  return (
    <section className="border-border border-t bg-[oklch(0.99_0.006_85)]">
      <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-8 md:grid-cols-[1fr_1.4fr] md:items-center">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 text-sm font-medium uppercase tracking-[0.22em] text-[oklch(0.5_0.09_60)]">
              <span className="h-px w-8 bg-[oklch(0.62_0.13_55)]" />
              Find us
            </p>
            <h2 className="font-[family-name:var(--font-fraunces)] text-3xl font-semibold tracking-tight">
              Easy to reach, easy to rest
            </h2>
            {isSet(address) ? (
              <p className="text-muted-foreground mt-4 flex items-start gap-2 text-sm leading-relaxed">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <span>{address}</span>
              </p>
            ) : null}
            <a
              href={directionsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary text-primary-foreground mt-6 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
            >
              <Navigation className="size-4" /> Get directions
            </a>
          </div>

          <div className="border-border overflow-hidden rounded-2xl border shadow-sm">
            <iframe
              src={embedSrc}
              title="Map showing Bañares Traveler's Inn"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-72 w-full border-0 sm:h-80"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
