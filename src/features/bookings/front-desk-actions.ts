"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { paymentSchema } from "./payment-schema";
import { peso } from "./pricing";
import { actualStayWindow } from "./stay-window";
import { getBookingWithPayments, parsePeriod, type BookingDetail } from "./repository";

function revalidateBookings() {
  revalidatePath("/bookings");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

// Fetch everything the manage dialog needs in one guarded round-trip.
export async function loadBookingDetail(id: string): Promise<ActionResult<BookingDetail>> {
  try {
    await requireRole(["admin", "front_desk"]);
    const detail = await getBookingWithPayments(id);
    if (!detail) return fail("Booking not found.");
    return ok(detail);
  } catch (err) {
    return toActionError(err);
  }
}

async function transition(
  id: string,
  from: string,
  to: "checked_in" | "checked_out" | "no_show",
  roomStatus: "occupied" | "cleaning" | null,
  action: string,
  /** Replace the booked check-out with the moment this ran. Only check-out
   *  passes it: that transition is the one that learns something the booking
   *  could only estimate. */
  stampActualCheckOut = false
): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole(["admin", "front_desk"]);
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, status, room_id, period")
    .eq("id", id)
    .maybeSingle();
  if (!booking) return fail("Booking not found.");
  if (booking.status !== from) return fail(`Booking is not ${from.replace("_", " ")}.`);

  const update: { status: typeof to; period?: string } = { status: to };
  const diff: Record<string, unknown> = { to };

  if (stampActualCheckOut) {
    const { checkIn, checkOut } = parsePeriod((booking as { period: string }).period);
    const actual = actualStayWindow(checkIn, new Date());
    // Only when it actually moved: re-writing the same window would put a
    // meaningless "left early/late" line in the activity trail.
    if (actual && actual.checkOut !== new Date(checkOut).toISOString()) {
      update.period = actual.period;
      // The booked window is overwritten, so the trail carries what it was —
      // otherwise "due out at noon, left at 4pm" becomes unanswerable.
      diff.scheduled_check_out = checkOut;
      diff.actual_check_out = actual.checkOut;
    }
  }

  // Status and period move in ONE statement. `no_overlap` only indexes
  // confirmed/checked_in/pending_verification rows, so a guest who overstays
  // into the next booking's window still checks out: the row leaves the
  // constraint in the same update that extends it.
  const { error } = await supabase.from("bookings").update(update).eq("id", id);
  if (error) return fail(error.message);

  // Sync the room's housekeeping status with the stay lifecycle.
  if (roomStatus && booking.room_id) {
    await supabase.from("rooms").update({ status: roomStatus }).eq("id", booking.room_id);
  }

  await logAudit({ actorId: user.id, action, entity: "booking", entityId: id, diff });
  revalidateBookings();
  return ok({ id });
}

export async function checkIn(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    return await transition(id, "confirmed", "checked_in", "occupied", "booking.check_in");
  } catch (err) {
    return toActionError(err);
  }
}

export async function checkOut(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    // The booked check-out is a plan — derived for a block tier, standard noon
    // for an overnight one. Checking the guest out is when the real time is
    // known, so it replaces it (the previous one survives in the audit trail).
    return await transition(id, "checked_in", "checked_out", "cleaning", "booking.check_out", true);
  } catch (err) {
    return toActionError(err);
  }
}

export async function markNoShow(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    return await transition(id, "confirmed", "no_show", null, "booking.no_show");
  } catch (err) {
    return toActionError(err);
  }
}

export async function recordPayment(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin", "front_desk"]);
    const parsed = paymentSchema.parse(input);
    const supabase = await createClient();

    // A booking awaiting deposit verification must be confirmed or rejected
    // through the verification panel (verification-actions.ts), which
    // records the payment itself as part of that transition. Recording a
    // payment here would leave the booking stuck pending_verification with
    // money attached, or double-record it if staff also use the panel.
    const { data: booking } = await supabase
      .from("bookings")
      .select("status, quoted_total")
      .eq("id", parsed.booking_id)
      .maybeSingle();
    if (booking?.status === "pending_verification") {
      return fail(
        "This booking is awaiting deposit verification. Use the verify panel to confirm or reject it — that records the payment for you."
      );
    }

    // Never take more than the booking is worth: an overpayment would inflate
    // revenue in reports with no way to express it as anything but "paid".
    // (Walk-ins can't reach this at all — they settle in full at booking.)
    const { data: existing } = await supabase
      .from("payments")
      .select("amount")
      .eq("booking_id", parsed.booking_id);
    const alreadyPaid = (existing ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
    const balance = Number(booking?.quoted_total ?? 0) - alreadyPaid;
    // numeric(10,2) money — a half-centavo of slack keeps float noise from
    // rejecting a payment that exactly settles the balance.
    if (balance <= 0.005) return fail("This booking is already paid in full.");
    if (parsed.amount - balance > 0.005) {
      return fail(`That is more than the ${peso.format(balance)} still due on this booking.`);
    }

    const { data, error } = await supabase
      .from("payments")
      .insert({
        booking_id: parsed.booking_id,
        amount: parsed.amount,
        method: parsed.method,
        reference: parsed.reference || null,
        recorded_by: user.id,
      })
      .select("id")
      .single();
    if (error) return fail(error.message);

    await logAudit({
      actorId: user.id,
      action: "payment.record",
      entity: "booking",
      entityId: parsed.booking_id,
      diff: { amount: parsed.amount, method: parsed.method },
    });
    revalidateBookings();
    return ok({ id: data.id });
  } catch (err) {
    return toActionError(err);
  }
}

export async function reassignRoom(
  bookingId: string,
  roomId: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin", "front_desk"]);
    const supabase = await createClient();
    const { error } = await supabase
      .from("bookings")
      .update({ room_id: roomId })
      .eq("id", bookingId);
    if (error) {
      // 23P01 = exclusion_violation (room taken for this window in a race).
      if (error.code === "23P01") return fail("That room is no longer free for these dates.");
      return fail(error.message);
    }
    await logAudit({
      actorId: user.id,
      action: "booking.reassign_room",
      entity: "booking",
      entityId: bookingId,
      diff: { room_id: roomId },
    });
    revalidateBookings();
    return ok({ id: bookingId });
  } catch (err) {
    return toActionError(err);
  }
}
