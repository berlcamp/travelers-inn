"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { bookingSchema } from "./schemas";
import { checkOutValue } from "./pricing";

// datetime-local strings carry no timezone; new Date() reads them in the
// server's local zone. For a single-location inn that is the intended behavior
// (staff enter local wall-clock times). Convert to ISO for the RPC.
function toIso(local: string): string {
  return new Date(local).toISOString();
}

// A walk-in books and pays the whole price at the same counter, so
// createBooking records the payment too — always for exactly the booking's own
// `quoted_total`, never a client-supplied figure, which is what makes a part
// payment or an overpayment impossible here rather than merely discouraged.
// The two writes can't share a transaction from here (the booking comes back
// from an RPC), so a failed payment insert is reported rather than swallowed:
// the booking exists and staff finish it in the manage dialog.
export async function createBooking(
  input: unknown
): Promise<
  ActionResult<{
    id: string;
    reference_code: string;
    quoted_total: number;
    paid: number;
    paymentError: string | null;
  }>
> {
  try {
    const user = await requireRole(["admin", "front_desk"]);
    const parsed = bookingSchema.parse(input);
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("fn_create_booking", {
      p_guest_name: parsed.guest_name,
      // The function nullif()s empty strings; pass "" rather than null so the
      // generated (non-nullable) RPC arg types are satisfied.
      p_guest_phone: parsed.guest_phone || "",
      p_guest_email: parsed.guest_email || "",
      p_room_type_id: parsed.room_type_id,
      p_rate_tier_id: parsed.rate_tier_id,
      p_guest_count: parsed.guest_count,
      p_check_in: toIso(parsed.check_in),
      // Blocks derive check-out server-side; pass check-in as a harmless
      // placeholder when the form left it empty. An overnight check-out is
      // snapped to noon (checkOutValue) so the RPC prices the same window the
      // form previewed — the form sends a date, the hour is the house rule.
      p_check_out: toIso(parsed.check_out ? checkOutValue(parsed.check_out) : parsed.check_in),
      p_source: "walk_in",
      p_notes: parsed.notes || "",
      // Omitted (not "") when the clerk didn't name a room: the parameter is
      // uuid, so an empty string is a cast error rather than "no preference".
      ...(parsed.room_id ? { p_room_id: parsed.room_id } : {}),
    });

    // fn_create_booking raises user-safe messages (no availability, invalid
    // period, over-capacity, inactive type/rate) — surface them directly.
    if (error) return fail(error.message);

    const row = (Array.isArray(data) ? data[0] : data) as {
      id: string;
      reference_code: string;
      quoted_total: number | string;
    } | null;
    if (!row) return fail("Could not create the booking. Please try again.");

    await logAudit({
      actorId: user.id,
      action: "booking.create",
      entity: "booking",
      entityId: row.id,
      diff: {
        source: "walk_in",
        room_type_id: parsed.room_type_id,
        // Records that a human chose the room, which the room_id on the booking
        // alone can't say — every booking has one either way.
        room_chosen: parsed.room_id ? parsed.room_id : null,
      },
    });

    // Payment taken at the desk, in full. The amount is the row's own
    // quoted_total (the price fn_create_booking just computed), so the ledger
    // can't drift from the quote; the sync_payment_status trigger then derives
    // payment_status = 'paid' from it, and nothing else needs updating.
    const total = Number(row.quoted_total);
    let paid = 0;
    let paymentError: string | null = null;
    const { error: payError } = await supabase.from("payments").insert({
      booking_id: row.id,
      amount: total,
      method: parsed.payment_method,
      reference: parsed.payment_reference || null,
      recorded_by: user.id,
    });
    if (payError) {
      paymentError = payError.message;
    } else {
      paid = total;
      await logAudit({
        actorId: user.id,
        action: "payment.record",
        entity: "booking",
        entityId: row.id,
        diff: { amount: total, method: parsed.payment_method },
      });
    }

    revalidatePath("/bookings");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return ok({
      id: row.id,
      reference_code: row.reference_code,
      quoted_total: total,
      paid,
      paymentError,
    });
  } catch (err) {
    return toActionError(err);
  }
}

// Which rooms of a type are free in a window — the walk-in dialog's live
// availability figure AND the room picker come from this one call. It replaced
// a `fn_count_available` action: the count is just this list's length, and
// asking twice invited the two answers to disagree between round trips.
export async function listFreeRooms(
  roomTypeId: string,
  checkInLocal: string,
  checkOutLocal: string
): Promise<ActionResult<{ rooms: { id: string; label: string }[] }>> {
  try {
    await requireRole(["admin", "front_desk"]);
    if (!roomTypeId || !checkInLocal || !checkOutLocal) return ok({ rooms: [] });
    const checkIn = new Date(checkInLocal);
    const checkOut = new Date(checkOutLocal);
    if (!(checkOut.getTime() > checkIn.getTime())) return ok({ rooms: [] });

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("fn_available_rooms", {
      p_room_type_id: roomTypeId,
      p_check_in: checkIn.toISOString(),
      p_check_out: checkOut.toISOString(),
      p_exclude_booking: undefined,
    });
    if (error) return fail(error.message);
    const rooms = ((data as { id: string; label: string }[] | null) ?? []).map((r) => ({
      id: r.id,
      label: r.label,
    }));
    return ok({ rooms });
  } catch (err) {
    return toActionError(err);
  }
}

export async function cancelBooking(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin", "front_desk"]);
    const supabase = await createClient();
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", id);
    if (error) return fail(error.message);
    await logAudit({
      actorId: user.id,
      action: "booking.cancel",
      entity: "booking",
      entityId: id,
    });
    revalidatePath("/bookings");
    // A cancellation frees the room AND takes its money back out of revenue
    // (analytics.countsAsRevenue), so the calendar and the dashboard are stale
    // the moment it happens. /reports and /collections read the URL, so they
    // are dynamic and re-run anyway.
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return ok({ id });
  } catch (err) {
    return toActionError(err);
  }
}
