"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  loadProofUrl,
  confirmBooking,
  rejectBooking,
} from "@/features/bookings/verification-actions";
import { peso } from "@/features/bookings/pricing";
import { PAYMENT_METHOD_LABELS } from "@/features/bookings/payment-schema";
import type { ProofRow } from "@/features/bookings/repository";

export function VerificationPanel({
  bookingId,
  proof,
  onDone,
}: {
  bookingId: string;
  proof: ProofRow | null;
  onDone: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [amount, setAmount] = useState(proof ? String(Number(proof.declared_amount)) : "");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  // The bucket is private, so the image needs a freshly signed URL each time
  // the panel mounts. Skip the round-trip entirely when there's no proof row.
  useEffect(() => {
    if (!proof) return;
    let cancelled = false;
    void loadProofUrl(bookingId).then((result) => {
      if (cancelled) return;
      if (result.ok) setUrl(result.data.url);
      else setUrlError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [bookingId, proof]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(okMsg);
        onDone();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  const isPdf = proof?.storage_path.toLowerCase().endsWith(".pdf");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <span className="text-sm font-medium">Verify deposit</span>

      {!proof ? (
        <p className="text-muted-foreground text-sm">
          No proof of payment was attached. Contact the guest before confirming, or reject this
          booking to free the room.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Method</span>
              <span className="font-medium">{PAYMENT_METHOD_LABELS[proof.method]}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Reference</span>
              <span className="font-mono text-xs font-medium">{proof.reference_no ?? "—"}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Guest says they sent</span>
              <span className="font-medium">{peso.format(Number(proof.declared_amount))}</span>
            </div>
          </div>

          {url ? (
            isPdf ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary inline-flex items-center gap-1.5 text-sm underline"
              >
                <ExternalLink className="size-3.5" /> Open the PDF receipt
              </a>
            ) : (
              <a href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="Proof of payment"
                  className="border-border max-h-72 w-full rounded-lg border object-contain"
                />
              </a>
            )
          ) : urlError ? (
            <p className="text-muted-foreground text-sm">{urlError}</p>
          ) : (
            <p className="text-muted-foreground text-sm">Loading proof…</p>
          )}
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">Amount actually received</span>
        <Input
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <Input
        placeholder="Reason (shown in the booking notes)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending || !(Number(amount) > 0)}
          onClick={() => run(() => confirmBooking(bookingId, Number(amount)), "Booking confirmed.")}
        >
          <Check className="size-4" /> Confirm booking
        </Button>
        <ConfirmDialog
          title="Reject this payment?"
          description="This cancels the booking and frees the room. Call the guest to let them know."
          confirmLabel="Reject & cancel"
          onConfirm={() => run(() => rejectBooking(bookingId, reason), "Booking rejected.")}
          trigger={
            <Button size="sm" variant="outline" disabled={pending}>
              <X className="size-4" /> Reject
            </Button>
          }
        />
      </div>
    </div>
  );
}
