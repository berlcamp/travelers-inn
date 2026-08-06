"use client";

import { usePathname } from "next/navigation";

// Only segments with a label become a crumb — an id in the path is a record,
// not a place, and naming it "e3f1a…" tells nobody anything.
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  availability: "Availability",
  calendar: "Calendar",
  bookings: "Bookings",
  rooms: "Rooms",
  qr: "QR Codes",
  feedbacks: "Feedback",
  reports: "Reports",
  "room-types": "Room Types",
  users: "Staff",
  settings: "Settings",
};

export function Breadcrumbs() {
  const pathname = usePathname();

  const crumbs: { label: string; href: string }[] = [];
  let path = "";
  for (const segment of pathname.split("/").filter(Boolean)) {
    path += `/${segment}`;
    const label = SEGMENT_LABELS[segment];
    if (!label) continue;
    crumbs.push({ label, href: path });
  }

  if (crumbs.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 text-sm">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {i > 0 ? <span className="text-muted-foreground text-xs select-none">/</span> : null}
          <span
            className={
              i === crumbs.length - 1 ? "text-foreground font-semibold" : "text-muted-foreground"
            }
          >
            {crumb.label}
          </span>
        </span>
      ))}
    </nav>
  );
}
