"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

type Stay = "nightly" | "hourly";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function dateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dtLocal(d: Date) {
  return `${dateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SearchBar({
  defaults,
}: {
  defaults?: { checkIn?: string; checkOut?: string; stay?: Stay };
}) {
  const router = useRouter();

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [stay, setStay] = useState<Stay>(defaults?.stay ?? "nightly");
  const [inDate, setInDate] = useState(defaults?.checkIn?.slice(0, 10) ?? dateStr(today));
  const [outDate, setOutDate] = useState(defaults?.checkOut?.slice(0, 10) ?? dateStr(tomorrow));

  const noon = new Date();
  noon.setHours(noon.getHours() + 1, 0, 0, 0);
  const later = new Date(noon);
  later.setHours(later.getHours() + 3);
  const [inDT, setInDT] = useState(defaults?.checkIn ?? dtLocal(noon));
  const [outDT, setOutDT] = useState(defaults?.checkOut ?? dtLocal(later));

  function submit() {
    const checkIn = stay === "nightly" ? `${inDate}T14:00` : inDT;
    const checkOut = stay === "nightly" ? `${outDate}T12:00` : outDT;
    const params = new URLSearchParams({ checkIn, checkOut, stay });
    router.push(`/?${params.toString()}`);
  }

  const fieldCls =
    "border-border bg-background focus:ring-ring/40 h-11 rounded-lg border px-3 text-sm outline-none focus:ring-2";

  return (
    <div className="bg-card/80 border-border/70 shadow-primary/5 flex flex-col gap-3 rounded-2xl border p-3 shadow-xl backdrop-blur sm:flex-row sm:items-end sm:gap-2">
      <div className="flex flex-1 flex-col gap-1.5">
        <label className="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">
          Stay
        </label>
        <div className="bg-muted flex rounded-lg p-1">
          {(["nightly", "hourly"] as Stay[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStay(s)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                stay === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {stay === "nightly" ? (
        <>
          <Field label="Check-in">
            <input type="date" value={inDate} onChange={(e) => setInDate(e.target.value)} className={fieldCls} />
          </Field>
          <Field label="Check-out">
            <input type="date" value={outDate} onChange={(e) => setOutDate(e.target.value)} className={fieldCls} />
          </Field>
        </>
      ) : (
        <>
          <Field label="From">
            <input
              type="datetime-local"
              value={inDT}
              onChange={(e) => setInDT(e.target.value)}
              className={fieldCls}
            />
          </Field>
          <Field label="Until">
            <input
              type="datetime-local"
              value={outDT}
              onChange={(e) => setOutDT(e.target.value)}
              className={fieldCls}
            />
          </Field>
        </>
      )}

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
