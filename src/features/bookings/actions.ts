"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { bookingSchema } from "./schemas";

// datetime-local strings carry no timezone; new Date() reads them in the
// server's local zone. For a single-location inn that is the intended behavior
// (staff enter local wall-clock times). Convert to ISO for the RPC.
function toIso(local: string): string {
  return new Date(local).toISOString();
}

export async function createBooking(
  input: unknown
): Promise<ActionResult<{ id: string; reference_code: string }>> {
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
      p_stay_type: parsed.stay_type,
      p_check_in: toIso(parsed.check_in),
      p_check_out: toIso(parsed.check_out),
      p_source: "walk_in",
      p_notes: parsed.notes || "",
    });

    // fn_create_booking raises user-safe messages (no availability, invalid
    // period, hourly unavailable, inactive type) — surface them directly.
    if (error) return fail(error.message);

    const row = (Array.isArray(data) ? data[0] : data) as {
      id: string;
      reference_code: string;
    } | null;
    if (!row) return fail("Could not create the booking. Please try again.");

    await logAudit({
      actorId: user.id,
      action: "booking.create",
      entity: "booking",
      entityId: row.id,
      diff: { source: "walk_in", room_type_id: parsed.room_type_id },
    });
    revalidatePath("/bookings");
    return ok({ id: row.id, reference_code: row.reference_code });
  } catch (err) {
    return toActionError(err);
  }
}

export async function checkAvailability(
  roomTypeId: string,
  checkInLocal: string,
  checkOutLocal: string
): Promise<ActionResult<{ count: number }>> {
  try {
    await requireRole(["admin", "front_desk"]);
    if (!roomTypeId || !checkInLocal || !checkOutLocal) return ok({ count: 0 });
    const checkIn = new Date(checkInLocal);
    const checkOut = new Date(checkOutLocal);
    if (!(checkOut.getTime() > checkIn.getTime())) return ok({ count: 0 });

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("fn_count_available", {
      p_room_type_id: roomTypeId,
      p_check_in: checkIn.toISOString(),
      p_check_out: checkOut.toISOString(),
    });
    if (error) return fail(error.message);
    return ok({ count: (data as number) ?? 0 });
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
    return ok({ id });
  } catch (err) {
    return toActionError(err);
  }
}
