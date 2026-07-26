"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { PROOF_BUCKET } from "@/features/portal/repository";
import { getProof } from "./repository";

const SIGNED_URL_TTL = 300; // 5 minutes — long enough to review, short enough not to leak

function revalidateBookings() {
  revalidatePath("/bookings");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

// Proofs live in a PRIVATE bucket, so the browser can't fetch the object
// directly. Mint a short-lived signed URL per view instead.
export async function loadProofUrl(bookingId: string): Promise<ActionResult<{ url: string }>> {
  try {
    await requireRole(["admin", "front_desk"]);
    const proof = await getProof(bookingId);
    if (!proof) return fail("No proof of payment on file.");

    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(PROOF_BUCKET)
      .createSignedUrl(proof.storage_path, SIGNED_URL_TTL);
    if (error || !data) return fail("Could not open the proof file.");
    return ok({ url: data.signedUrl });
  } catch (err) {
    return toActionError(err);
  }
}

// Verify the deposit: record the money, then confirm the booking. The
// payments trigger derives payment_status, so the badge can never drift from
// the ledger.
//
// The status flip is a conditional UPDATE (WHERE status = 'pending_verification')
// rather than a plain one, so two staff members racing to confirm the same
// booking can't both succeed: only the first UPDATE matches a row. If ours
// loses that race, we roll back the payment we just inserted so the money is
// never double-recorded against a booking someone else already handled.
export async function confirmBooking(
  bookingId: string,
  amount: number
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin", "front_desk"]);
    if (!(amount > 0)) return fail("Enter the amount you verified.");
    const supabase = await createClient();

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, status")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return fail("Booking not found.");
    if (booking.status !== "pending_verification") {
      return fail("This booking is not awaiting verification — someone may have already handled it.");
    }

    const proof = await getProof(bookingId);

    const { data: payment, error: payError } = await supabase
      .from("payments")
      .insert({
        booking_id: bookingId,
        amount,
        method: proof?.method ?? "gcash",
        reference: proof?.reference_no ?? null,
        recorded_by: user.id,
      })
      .select("id")
      .single();
    if (payError || !payment) return fail(payError?.message ?? "Could not record the payment.");

    const { data: updated, error } = await supabase
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", bookingId)
      .eq("status", "pending_verification")
      .select("id")
      .maybeSingle();
    if (error) {
      await supabase.from("payments").delete().eq("id", payment.id);
      return fail(error.message);
    }
    if (!updated) {
      // Lost the race: someone else already confirmed/rejected this booking.
      // Undo the payment we just inserted so it isn't double-recorded.
      await supabase.from("payments").delete().eq("id", payment.id);
      return fail("This booking was already handled by someone else.");
    }

    await logAudit({
      actorId: user.id,
      action: "booking.verify_confirm",
      entity: "booking",
      entityId: bookingId,
      diff: { amount, reference: proof?.reference_no ?? null },
    });
    revalidateBookings();
    return ok({ id: bookingId });
  } catch (err) {
    return toActionError(err);
  }
}

// Reject: cancel the booking, freeing the room. Staff phone the guest on the
// number the portal requires — there is no guest-facing re-upload flow.
//
// Same conditional-UPDATE guard as confirmBooking: only fires against a
// booking that is still pending_verification, so two staff can't both act on
// the same booking (one confirm, one reject) and leave inconsistent state.
export async function rejectBooking(
  bookingId: string,
  reason: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin", "front_desk"]);
    const supabase = await createClient();

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, status, notes")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return fail("Booking not found.");
    if (booking.status !== "pending_verification") {
      return fail("This booking is not awaiting verification — someone may have already handled it.");
    }

    const note = `Payment rejected: ${reason || "no reason given"}`;
    const { data: updated, error } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        notes: booking.notes ? `${booking.notes}\n${note}` : note,
      })
      .eq("id", bookingId)
      .eq("status", "pending_verification")
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!updated) {
      return fail("This booking was already handled by someone else.");
    }

    await logAudit({
      actorId: user.id,
      action: "booking.verify_reject",
      entity: "booking",
      entityId: bookingId,
      diff: { reason },
    });
    revalidateBookings();
    return ok({ id: bookingId });
  } catch (err) {
    return toActionError(err);
  }
}
