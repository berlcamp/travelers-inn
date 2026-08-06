"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toCsv } from "@/features/reports/csv";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/features/bookings/payment-schema";
import { BOOKING_STATUS_LABELS, type BookingStatus } from "@/features/bookings/schemas";
import { BOOKING_SOURCE_LABELS } from "@/features/bookings/trail";
import type { ReportBooking, ReportPayment } from "@/features/reports/analytics";

// Built in the browser from data already on the page — no export endpoint, so
// there's no second code path that could disagree with what's on screen.
function download(filename: string, csv: string) {
  // The BOM makes Excel read it as UTF-8; without it, ₱ and accented names
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

export function ExportButtons({
  payments,
  bookings,
  from,
  to,
}: {
  payments: ReportPayment[];
  bookings: ReportBooking[];
  from: string;
  to: string;
}) {
  function exportPayments() {
    download(
      `payments-${from}_to_${to}.csv`,
      toCsv(
        ["Received", "Reference", "Guest", "Method", "Amount", "Payment ref", "Received by"],
        payments.map((p) => [
          stamp(p.createdAt),
          p.bookingRef,
          p.guestName,
          PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method,
          p.amount,
          p.reference,
          p.recordedByName ?? "",
        ])
      )
    );
  }

  function exportBookings() {
    download(
      `bookings-${from}_to_${to}.csv`,
      toCsv(
        [
          "Booked on",
          "Reference",
          "Guest",
          "Room",
          "Room type",
          "Check-in",
          "Check-out",
          "Guests",
          "Status",
          "Source",
          "Total",
          "Taken by",
          "Verified by",
        ],
        bookings.map((b) => [
          stamp(b.createdAt),
          b.referenceCode,
          b.guestName,
          b.roomLabel,
          b.roomTypeName,
          b.checkIn ? stamp(b.checkIn) : "",
          b.checkOut ? stamp(b.checkOut) : "",
          b.guestCount,
          BOOKING_STATUS_LABELS[b.status as BookingStatus] ?? b.status,
          BOOKING_SOURCE_LABELS[b.source] ?? b.source,
          b.quotedTotal,
          b.createdByName ?? "",
          b.verifiedByName ?? "",
        ])
      )
    );
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button variant="outline" size="sm" onClick={exportPayments} disabled={payments.length === 0}>
        <Download className="size-4" /> Payments CSV
      </Button>
      <Button variant="outline" size="sm" onClick={exportBookings} disabled={bookings.length === 0}>
        <Download className="size-4" /> Bookings CSV
      </Button>
    </div>
  );
}
