"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { paymentSchema } from "./payment-schema";
import { getBookingWithPayments, type BookingDetail } from "./repository";

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
  action: string
): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole(["admin", "front_desk"]);
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, status, room_id")
    .eq("id", id)
    .maybeSingle();
  if (!booking) return fail("Booking not found.");
  if (booking.status !== from) return fail(`Booking is not ${from.replace("_", " ")}.`);

  const { error } = await supabase.from("bookings").update({ status: to }).eq("id", id);
  if (error) return fail(error.message);

  // Sync the room's housekeeping status with the stay lifecycle.
  if (roomStatus && booking.room_id) {
    await supabase.from("rooms").update({ status: roomStatus }).eq("id", booking.room_id);
  }

  await logAudit({ actorId: user.id, action, entity: "booking", entityId: id, diff: { to } });
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
    return await transition(id, "checked_in", "checked_out", "cleaning", "booking.check_out");
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
