"use client";

import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ColumnDef } from "@tanstack/react-table";
import type { FeedbackWithRoom } from "@/features/feedback/repository";

const dt = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`size-3.5 ${
            n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
          }`}
        />
      ))}
    </span>
  );
}

const columns: ColumnDef<FeedbackWithRoom>[] = [
  {
    accessorKey: "created_at",
    header: "Date",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {dt.format(new Date(row.original.created_at))}
      </span>
    ),
  },
  {
    id: "room",
    header: "Room",
    cell: ({ row }) => {
      const room = row.original.room;
      return (
        <span className="text-sm font-medium">
          {room ? `Room ${room.label}` : "—"}
          {room?.room_type ? (
            <span className="text-muted-foreground font-normal"> · {room.room_type.name}</span>
          ) : null}
        </span>
      );
    },
  },
  {
    accessorKey: "rating",
    header: "Rating",
    cell: ({ row }) => <Stars rating={row.original.rating} />,
  },
  {
    accessorKey: "comment",
    header: "Comment",
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.comment ?? <span className="text-muted-foreground">—</span>}
      </span>
    ),
  },
  {
    accessorKey: "guest_name",
    header: "Guest",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {row.original.guest_name ?? "Anonymous"}
      </span>
    ),
  },
];

// Each option carries its own predicate rather than a shared "minimum
// rating" number: a plain `rating >= N` threshold cannot express "1–2 stars"
// (a bounded range, not a floor) in the same scheme as "4 stars and up".
const FILTERS = {
  all: () => true,
  "4plus": (rating: number) => rating >= 4,
  "3plus": (rating: number) => rating >= 3,
  low: (rating: number) => rating <= 2,
} as const satisfies Record<string, (rating: number) => boolean>;

type FilterKey = keyof typeof FILTERS;

const FILTER_OPTIONS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "All ratings" },
  { value: "4plus", label: "4 stars and up" },
  { value: "3plus", label: "3 stars and up" },
  { value: "low", label: "1–2 stars (needs attention)" },
];

export function FeedbacksTable({ feedback }: { feedback: FeedbackWithRoom[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const rows = useMemo(() => feedback.filter((f) => FILTERS[filter](f.rating)), [feedback, filter]);

  // The rating filter rides in the table's own toolbar rather than above it, so
  // search and filter sit on one row like every other list.
  const ratingFilter = (
    <Select
      items={FILTER_OPTIONS}
      value={filter}
      onValueChange={(v) => setFilter((v as FilterKey) ?? "all")}
    >
      <SelectTrigger className="h-8 w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FILTER_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        columns={columns}
        data={rows}
        toolbar={ratingFilter}
        searchPlaceholder="Search comments, rooms, guests…"
        emptyMessage="No feedback matches that filter."
      />
    </div>
  );
}
