"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { bookingSchema } from "./schemas";
import { checkOutValue } from "./pricing";
import { fromInnClock } from "@/lib/inn-time";
import { PROOF_BUCKET } from "@/features/portal/repository";

// datetime-local strings carry no timezone, so somebody has to decide which
// clock they are on. It is the INN's clock — the desk types the hour it is in
// Bayugan — never the server's.
//
// This used to be `new Date(local)`, which reads a zoneless string in the
// PROCESS's zone: Asia/Manila on a laptop, UTC on the deployed server. A
// walk-in typed as "Aug 17, 8:17 PM" was stored as 20:17Z and read back as
// 4:17 AM on the 18th — right in dev, eight hours wrong in production. See
// src/lib/inn-time.ts.
function toIso(local: string): string {
  return fromInnClock(local).toISOString();
}

// A walk-in books and pays the whole price at the same counter, so
// createBooking records the payment too — always for exactly the booking's own
// `quoted_total`, never a client-supplied figure, which is what makes a part
// payment or an overpayment impossible here rather than merely discouraged.
// The two writes can't share a transaction from here (the booking comes back
// from an RPC), so a failed payment insert is reported rather than swallowed:
// the booking exists and staff finish it in the manage dialog.
export async function createBooking(input: unknown): Promise<
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
    // Inn clock, same as the window the booking will be written with — asking
    // availability about a different eight hours than the one being booked is
    // how a "free" room turns into an exclusion-constraint error on submit.
    const checkIn = fromInnClock(checkInLocal);
    const checkOut = fromInnClock(checkOutLocal);
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

// Erase a booking completely. ADMIN ONLY — see migration 20260817000100, which
// also stops the DELETE at the database, so this guard is the product's answer
// and the policy is the real one.
//
// This is not cancellation and must never be offered as a tidier version of
// it. Cancelling keeps the record and takes the money out of revenue, which is
// what an inn that has to explain last month's figures needs. Deleting is for
// a booking that should never have existed — a duplicate, a test row, a guest
// keyed twice — and it removes the row, its payments and its proofs from every
// report at once, retrospectively. So the ledger has to survive somewhere: the
// audit entry below carries a full snapshot (reference, guest, window, price,
// and each payment's amount and method), because `audit_logs.entity_id` has no
// foreign key to bookings and outlives the row it names.
export async function deleteBooking(
  id: string
): Promise<ActionResult<{ id: string; reference_code: string }>> {
  try {
    const user = await requireRole(["admin"]);
    const supabase = await createClient();

    // Read everything worth keeping BEFORE the delete: payments and proofs
    // cascade away with the booking, so afterwards there is nothing left to
    // describe what was destroyed.
    const { data: booking, error: readError } = await supabase
      .from("bookings")
      // ONE string literal, not a concatenation: supabase-js parses the select
      // list at the TYPE level with template-literal types, and `"a, " + "b"`
      // widens to plain `string` — the row then infers as GenericStringError
      // and every field read below fails to compile.
      .select(
        "id, reference_code, guest_name, guest_phone, guest_email, status, payment_status, quoted_total, guest_count, source, room_id, room_type_id, rate_tier_id, period, created_at"
      )
      .eq("id", id)
      .maybeSingle();
    if (readError) return fail(readError.message);
    if (!booking) return fail("That booking no longer exists.");

    const [{ data: payments }, { data: proofs }] = await Promise.all([
      supabase
        .from("payments")
        .select("amount, method, reference, created_at")
        .eq("booking_id", id),
      supabase.from("booking_proofs").select("storage_path").eq("booking_id", id),
    ]);

    // .select() so a delete that matched NOTHING is a failure rather than a
    // cheerful no-op: RLS filters rows out silently, so without this a
    // front-desk user (or a deactivated admin) would be told it worked.
    const { data: deleted, error } = await supabase
      .from("bookings")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return fail(error.message);
    if (!deleted || deleted.length === 0) {
      return fail("You do not have permission to delete this booking.");
    }

    // A checked-in guest's room is 'occupied', and the booking that put it
    // there is now gone — leaving it occupied would strand the room with no
    // record explaining why. Same landing as check-out: the room was slept in.
    if (booking.status === "checked_in" && booking.room_id) {
      await supabase.from("rooms").update({ status: "cleaning" }).eq("id", booking.room_id);
    }

    await logAudit({
      actorId: user.id,
      action: "booking.delete",
      entity: "booking",
      entityId: id,
      diff: {
        reference_code: booking.reference_code,
        guest_name: booking.guest_name,
        guest_phone: booking.guest_phone,
        guest_email: booking.guest_email,
        status: booking.status,
        payment_status: booking.payment_status,
        quoted_total: booking.quoted_total,
        guest_count: booking.guest_count,
        source: booking.source,
        room_id: booking.room_id,
        room_type_id: booking.room_type_id,
        rate_tier_id: booking.rate_tier_id,
        period: booking.period,
        booking_created_at: booking.created_at,
        payments: (payments ?? []).map((p) => ({
          amount: p.amount,
          method: p.method,
          reference: p.reference,
          created_at: p.created_at,
        })),
      },
    });

    // The proof ROWS cascaded; the files behind them did not — no cascade
    // reaches storage. Best-effort on purpose: the booking is already gone, so
    // failing here would report a failure that didn't happen. The worst case is
    // an orphaned file in a private bucket, and it is logged.
    const paths = (proofs ?? []).map((p) => p.storage_path).filter(Boolean);
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from(PROOF_BUCKET).remove(paths);
      if (storageError) {
        console.error("[deleteBooking] proof files left behind", { id, paths, storageError });
      }
    }

    revalidatePath("/bookings");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return ok({ id, reference_code: booking.reference_code });
  } catch (err) {
    return toActionError(err);
  }
}
