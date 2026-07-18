import { BedDouble } from "lucide-react";
import { cn } from "@/lib/utils";

// Curated warm palettes — no photos yet, so each room type gets a distinct,
// deterministic gradient identity keyed off its name.
const PALETTES = [
  "from-[oklch(0.55_0.09_185)] to-[oklch(0.42_0.07_200)]", // teal
  "from-[oklch(0.72_0.13_65)] to-[oklch(0.55_0.13_45)]", // amber/clay
  "from-[oklch(0.6_0.11_145)] to-[oklch(0.44_0.09_170)]", // moss
  "from-[oklch(0.58_0.13_300)] to-[oklch(0.42_0.1_320)]", // plum
  "from-[oklch(0.6_0.12_255)] to-[oklch(0.42_0.1_270)]", // indigo
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function RoomVisual({
  name,
  index,
  className,
}: {
  name: string;
  // When rendered in a list, pass the position so adjacent cards differ;
  // standalone (e.g. the booking page) falls back to a name hash.
  index?: number;
  className?: string;
}) {
  const palette = PALETTES[(index ?? hash(name)) % PALETTES.length];
  return (
    <div
      className={cn(
        "relative flex items-end overflow-hidden bg-gradient-to-br text-white",
        palette,
        className
      )}
    >
      {/* Soft light bloom + grain for depth. */}
      <div className="absolute -right-6 -top-8 size-32 rounded-full bg-white/20 blur-2xl" />
      <div className="absolute inset-0 opacity-[0.15] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:14px_14px]" />
      <BedDouble className="absolute right-4 top-4 size-5 text-white/70" />
      <span className="font-[family-name:var(--font-fraunces)] relative p-4 text-lg font-medium leading-tight drop-shadow-sm">
        {name}
      </span>
    </div>
  );
}
