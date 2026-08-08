"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toCsv } from "@/features/reports/csv";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/features/bookings/payment-schema";
import { BOOKING_SOURCE_LABELS } from "@/features/bookings/trail";
import { isCashMethod } from "@/features/reports/analytics";
import type { CollectionRow } from "@/features/collections/repository";

// Built in the browser from the rows already on the page — no export endpoint,
// so there is no second code path that could disagree with what was printed.
function download(filename: string, csv: string) {
  // The BOM makes Excel read it as UTF-8; without it ₱ and accented names
  // arrive mangled.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const stamp = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16);

export function CollectionsExport({
  payments,
  from,
  to,
  slug,
}: {
  payments: CollectionRow[];
  from: string;
  to: string;
  /** Whose sheet this is, for the filename — "all" or a name. */
  slug: string;
}) {
  function exportCsv() {
    download(
      `collections-${slug}-${from}_to_${to}.csv`,
      toCsv(
        [
          "Received",
          "Booking",
          "Guest",
          "Room",
          "Room type",
          "Channel",
          "Mode",
          "Cash",
          "Payment ref",
          "Amount",
          "Received by",
        ],
        payments.map((p) => [
          stamp(p.createdAt),
          p.bookingRef,
          p.guestName,
          p.roomLabel,
          p.roomTypeName,
          BOOKING_SOURCE_LABELS[p.source] ?? p.source,
          PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method,
          // A yes/no column rather than a separate cash-only export: the whole
          // point of the sheet is reconciling one against the other.
          isCashMethod(p.method) ? "Yes" : "No",
          p.reference,
          p.amount,
          p.recordedByName ?? "",
        ])
      )
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={exportCsv}
      disabled={payments.length === 0}
      className="print:hidden"
    >
      <Download className="size-4" /> Export CSV
    </Button>
  );
}
