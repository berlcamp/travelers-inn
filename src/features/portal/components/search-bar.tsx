"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function dateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The portal searches a nightly window; day-use blocks and exact guest counts
// are chosen on the booking page. Check-in defaults to 1pm, checkout to 12noon.
export function SearchBar({
  defaults,
}: {
  defaults?: { checkIn?: string; checkOut?: string };
}) {
  const router = useRouter();

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [inDate, setInDate] = useState(defaults?.checkIn?.slice(0, 10) ?? dateStr(today));
  const [outDate, setOutDate] = useState(defaults?.checkOut?.slice(0, 10) ?? dateStr(tomorrow));

  function submit() {
    const checkIn = `${inDate}T13:00`;
    const checkOut = `${outDate}T12:00`;
    const params = new URLSearchParams({ checkIn, checkOut });
    router.push(`/?${params.toString()}`);
  }

  const fieldCls =
    "border-border bg-background focus:ring-ring/40 focus:border-ring h-11 rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-2";

  return (
    <div className="border-border shadow-primary/5 flex flex-col gap-3 rounded-2xl border bg-white p-3 shadow-xl ring-1 ring-black/[0.02] sm:flex-row sm:items-end sm:gap-2.5">
      <Field label="Check-in">
        <input type="date" value={inDate} onChange={(e) => setInDate(e.target.value)} className={fieldCls} />
      </Field>
      <Field label="Check-out">
        <input type="date" value={outDate} onChange={(e) => setOutDate(e.target.value)} className={fieldCls} />
      </Field>
      <Button size="lg" className="h-11 shrink-0" onClick={submit}>
        <Search className="size-4" /> Search
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <label className="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
