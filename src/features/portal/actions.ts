"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { portalBookingWithProofSchema } from "./schemas";
import { getPortalPaymentInfo, PROOF_BUCKET } from "./repository";
import { depositFor } from "@/features/bookings/deposit";

const MAX_NIGHTS = 30;
const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_PROOF_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

// Public (no-login) portal booking with a deposit proof. Runs entirely
// server-side through the admin client so fn_create_booking stays off the anon
// grant. The booking is created as 'pending_verification' — it HOLDS the room
// but is not confirmed until staff inspect the proof.
export async function createPortalBookingWithProof(
  formData: FormData
): Promise<ActionResult<{ reference_code: string; deposit: number }>> {
  try {
    const file = formData.get("proof");
    if (!(file instanceof File) || file.size === 0) {
      return fail("Please attach a screenshot or PDF of your payment.");
    }
    if (file.size > MAX_PROOF_BYTES) return fail("The file must be 5 MB or smaller.");
    const ext = ALLOWED_PROOF_TYPES[file.type];
    if (!ext) return fail("Attach a JPEG, PNG, WebP, or PDF.");

    const parsed = portalBookingWithProofSchema.parse({
      guest_name: formData.get("guest_name"),
      guest_phone: formData.get("guest_phone"),
      guest_email: formData.get("guest_email") ?? "",
      room_type_id: formData.get("room_type_id"),
      rate_tier_id: formData.get("rate_tier_id"),
      guest_count: formData.get("guest_count"),
      check_in: formData.get("check_in"),
      check_out: formData.get("check_out") ?? "",
      method: formData.get("method"),
      reference_no: formData.get("reference_no"),
    });

    const checkIn = new Date(parsed.check_in);
    if (Number.isNaN(checkIn.getTime())) return fail("Please choose a valid date.");

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (checkIn < startOfToday) return fail("Please choose a future date.");

    // Overnight stays send a check-out; blocks derive it server-side.
    let checkOutISO = checkIn.toISOString();
    if (parsed.check_out) {
      const checkOut = new Date(parsed.check_out);
      if (Number.isNaN(checkOut.getTime())) return fail("Please choose a valid check-out date.");
      if (checkOut <= checkIn) return fail("Check-out must be after check-in.");
      if (checkOut.getTime() - checkIn.getTime() > MAX_NIGHTS * 86_400_000) {
        return fail("For stays longer than a month, please contact us directly.");
      }
      checkOutISO = checkOut.toISOString();
    }

    const admin = createAdminClient();

    // Upload FIRST: a storage failure must never leave a booking without proof.
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from(PROOF_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return fail("We couldn't upload your proof of payment. Please try again.");

    const { data, error } = await admin.rpc("fn_create_booking", {
      p_guest_name: parsed.guest_name,
      p_guest_phone: parsed.guest_phone,
      p_guest_email: parsed.guest_email || "",
      p_room_type_id: parsed.room_type_id,
      p_rate_tier_id: parsed.rate_tier_id,
      p_guest_count: parsed.guest_count,
      p_check_in: checkIn.toISOString(),
      p_check_out: checkOutISO,
      p_source: "portal",
      p_notes: "",
      p_status: "pending_verification",
    });
    if (error) {
      await admin.storage.from(PROOF_BUCKET).remove([path]); // don't orphan the object
      return fail(error.message);
    }

    const row = (Array.isArray(data) ? data[0] : data) as {
      id: string;
      reference_code: string;
      quoted_total: string | number;
    } | null;
    if (!row) {
      await admin.storage.from(PROOF_BUCKET).remove([path]);
      return fail("We couldn't complete your booking. Please try again.");
    }

    // Recomputed server-side from the authoritative total — never trusted from
    // the client, which only ever displayed this number.
    const { deposit_percent } = await getPortalPaymentInfo();
    const deposit = depositFor(Number(row.quoted_total), deposit_percent);

    const { error: proofError } = await admin.from("booking_proofs").insert({
      booking_id: row.id,
      method: parsed.method,
      reference_no: parsed.reference_no,
      declared_amount: deposit,
      storage_path: path,
    });

    // The booking is already committed and holding the room, and the file is
    // already in storage — a failure here must NOT fail the action (that would
    // either show the guest a false error or invite a duplicate submission on
    // top of a reservation that already exists). Instead leave a reconciliation
    // trail: everything needed to hand-link the orphaned object back to this
    // booking (storage bucket + path, declared method/reference/amount) goes
    // into the audit log and the server console, since the row itself is what
    // failed to write.
    if (proofError) {
      console.error("[portal] booking_proofs insert failed", {
        bookingId: row.id,
        storagePath: path,
        error: proofError,
      });
      await logAudit({
        action: "booking.portal_proof_insert_failed",
        entity: "booking",
        entityId: row.id,
        diff: {
          bucket: PROOF_BUCKET,
          storage_path: path,
          method: parsed.method,
          reference_no: parsed.reference_no,
          declared_amount: deposit,
          db_error: proofError.message,
        },
      });
    }

    await logAudit({
      action: "booking.portal_create_pending",
      entity: "booking",
      entityId: row.id,
      diff: { source: "portal", room_type_id: parsed.room_type_id, deposit },
    });
    revalidatePath("/");
    revalidatePath("/bookings");
    revalidatePath("/calendar");
    return ok({ reference_code: row.reference_code, deposit });
  } catch (err) {
    return toActionError(err);
  }
}
