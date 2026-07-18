"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { portalBookingSchema } from "./schemas";

const MAX_NIGHTS = 30;
const MAX_HOURS = 24;

// Public (no-login) portal booking. Runs entirely server-side through the admin
// client so fn_create_booking stays off the anon grant; every mutation passes
// through this one validated path. Bookings auto-confirm when a room is free.
export async function createPortalBooking(
  input: unknown
): Promise<ActionResult<{ reference_code: string }>> {
  try {
    const parsed = portalBookingSchema.parse(input);

    const checkIn = new Date(parsed.check_in);
    const checkOut = new Date(parsed.check_out);
    if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
      return fail("Please choose valid dates.");
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (checkIn < startOfToday) return fail("Please choose a future date.");
    if (checkOut <= checkIn) return fail("Check-out must be after check-in.");

    const ms = checkOut.getTime() - checkIn.getTime();
    if (parsed.stay_type === "nightly" && ms > MAX_NIGHTS * 86_400_000) {
      return fail("For stays longer than a month, please contact us directly.");
    }
    if (parsed.stay_type === "hourly" && ms > MAX_HOURS * 3_600_000) {
      return fail("For hourly stays please keep it within a day.");
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("fn_create_booking", {
      p_guest_name: parsed.guest_name,
      p_guest_phone: parsed.guest_phone,
      p_guest_email: parsed.guest_email || "",
      p_room_type_id: parsed.room_type_id,
      p_stay_type: parsed.stay_type,
      p_check_in: checkIn.toISOString(),
      p_check_out: checkOut.toISOString(),
      p_source: "portal",
      p_notes: "",
    });
    if (error) return fail(error.message);

    const row = (Array.isArray(data) ? data[0] : data) as {
      id: string;
      reference_code: string;
    } | null;
    if (!row) return fail("We couldn't complete your booking. Please try again.");

    await logAudit({
      action: "booking.portal_create",
      entity: "booking",
      entityId: row.id,
      diff: { source: "portal", room_type_id: parsed.room_type_id },
    });
    revalidatePath("/");
    revalidatePath("/bookings");
    revalidatePath("/calendar");
    return ok({ reference_code: row.reference_code });
  } catch (err) {
    return toActionError(err);
  }
}
