"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { roomTypeSchema, roomSchema, type RoomStatus } from "./schemas";

// ---- Room types (admin only) ------------------------------------------------

export async function saveRoomType(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin"]);
    const parsed = roomTypeSchema.parse(input);
    const supabase = await createClient();

    const row = {
      name: parsed.name,
      description: parsed.description || null,
      // The cover mirrors the first gallery photo so existing single-image
      // readers (portal cards, OG metadata) keep working unchanged. Removing
      // every photo clears the cover rather than leaving a stale image_url.
      image_url: parsed.photos[0]?.url ?? null,
      base_occupancy: parsed.base_occupancy,
      max_occupancy: parsed.max_occupancy,
      excess_person_rate: parsed.excess_person_rate,
      is_active: parsed.is_active,
    };

    let id: string;
    if (parsed.id) {
      const { data, error } = await supabase
        .from("room_types")
        .update(row)
        .eq("id", parsed.id)
        .select("id")
        .single();
      if (error) return fail(error.message);
      id = data.id;
    } else {
      const { data, error } = await supabase
        .from("room_types")
        .insert(row)
        .select("id")
        .single();
      if (error) return fail(error.message);
      id = data.id;
    }

    // Reconcile rate tiers. Existing tiers may be referenced by bookings
    // (rate_tier_id ON DELETE RESTRICT), so tiers dropped from the form are
    // deactivated rather than deleted; kept tiers are upserted with their order.
    const tierError = await syncRateTiers(supabase, id, parsed.tiers);
    if (tierError) return fail(tierError);

    const photoError = await syncPhotos(supabase, id, parsed.photos);
    if (photoError) return fail(photoError);

    await logAudit({
      actorId: user.id,
      action: parsed.id ? "room_type.update" : "room_type.create",
      entity: "room_type",
      entityId: id,
      diff: { ...row, tiers: parsed.tiers.length },
    });
    revalidatePath("/room-types");
    return ok({ id });
  } catch (err) {
    return toActionError(err);
  }
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type TierInput = z.infer<typeof roomTypeSchema>["tiers"][number];

async function syncRateTiers(
  supabase: SupabaseClient,
  roomTypeId: string,
  tiers: TierInput[]
): Promise<string | null> {
  const { data: existing, error: fetchErr } = await supabase
    .from("rate_tiers")
    .select("id")
    .eq("room_type_id", roomTypeId);
  if (fetchErr) return fetchErr.message;

  const keptIds = new Set<string>();
  for (const [i, t] of tiers.entries()) {
    const values = {
      room_type_id: roomTypeId,
      label: t.label,
      kind: t.kind,
      duration_hours: t.kind === "block" ? (t.duration_hours ?? null) : null,
      price: t.price,
      sort_order: i,
      is_active: true,
    };
    if (t.id) {
      keptIds.add(t.id);
      const { error } = await supabase.from("rate_tiers").update(values).eq("id", t.id);
      if (error) return error.message;
    } else {
      const { data, error } = await supabase
        .from("rate_tiers")
        .insert(values)
        .select("id")
        .single();
      if (error) return error.message;
      keptIds.add(data.id);
    }
  }

  const toDeactivate = (existing ?? []).map((r) => r.id).filter((rid) => !keptIds.has(rid));
  if (toDeactivate.length > 0) {
    const { error } = await supabase
      .from("rate_tiers")
      .update({ is_active: false })
      .in("id", toDeactivate);
    if (error) return error.message;
  }
  return null;
}

type PhotoInput = z.infer<typeof roomTypeSchema>["photos"][number];

// Photos have no FK dependents (unlike rate tiers, which bookings reference),
// so removed ones are hard-deleted — matching the design spec, which calls for
// deleting "row and storage object both". Array position becomes sort_order.
//
// Deleting the storage object alongside the row is the riskier half (a bug
// here could orphan a photo still referenced elsewhere, or misfire on a
// backfilled row), but leaving objects in place leaks the bucket forever on
// every reorder-and-remove edit, which is worse over the product's lifetime.
// The mitigation: only paths that (a) are non-empty and (b) do not appear
// anywhere in the surviving `photos` array are removed. Backfilled rows carry
// storage_path = "" (no object exists for them), so they're filtered out by
// the non-empty check and `remove()` is never called with an empty key.
//
// Insert-then-delete (not delete-then-insert): there's no unique constraint
// on this table, so the new rows can be inserted while the old ones still
// exist. If the insert fails, the old rows — and the room_types.image_url the
// caller already wrote just before calling this — are still backed by real
// photo rows instead of the type being left with a cover pointing at zero
// photos. The old rows are then deleted by the ids captured *before* the
// insert, so the delete can't touch rows the insert just created. For the
// width of this function a reader can see both the old and new rows at once
// (never neither) — the same momentary duplication `syncRateTiers` accepts
// for the same reason, and no worse than an ordinary two-statement write.
async function syncPhotos(
  supabase: SupabaseClient,
  roomTypeId: string,
  photos: PhotoInput[]
): Promise<string | null> {
  const { data: existing, error: fetchErr } = await supabase
    .from("room_type_photos")
    .select("id, storage_path")
    .eq("room_type_id", roomTypeId);
  if (fetchErr) return fetchErr.message;

  if (photos.length > 0) {
    const { error } = await supabase.from("room_type_photos").insert(
      photos.map((p, i) => ({
        room_type_id: roomTypeId,
        storage_path: p.storage_path || "",
        url: p.url,
        sort_order: i,
      }))
    );
    if (error) return error.message;
  }

  const existingIds = (existing ?? []).map((p) => p.id);
  if (existingIds.length > 0) {
    const { error: delError } = await supabase
      .from("room_type_photos")
      .delete()
      .in("id", existingIds);
    if (delError) return delError.message;
  }

  const keptPaths = new Set(photos.map((p) => p.storage_path).filter(Boolean));
  const orphanedPaths = (existing ?? [])
    .map((p) => p.storage_path)
    .filter((path): path is string => Boolean(path) && !keptPaths.has(path));
  if (orphanedPaths.length > 0) {
    // Best-effort: the DB rows are already synced at this point, so a storage
    // hiccup here shouldn't fail the whole save — it just leaves an orphaned
    // object for manual cleanup, which is the same outcome as never removing
    // objects at all, just narrower in scope.
    const { error: removeError } = await supabase.storage.from(PHOTO_BUCKET).remove(orphanedPaths);
    if (removeError) {
      console.error("room_type_photos: failed to remove storage objects", removeError.message);
    }
  }
  return null;
}

export async function toggleRoomTypeActive(
  id: string,
  active: boolean
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin"]);
    const supabase = await createClient();
    const { error } = await supabase.from("room_types").update({ is_active: active }).eq("id", id);
    if (error) return fail(error.message);
    await logAudit({
      actorId: user.id,
      action: "room_type.toggle_active",
      entity: "room_type",
      entityId: id,
      diff: { is_active: active },
    });
    revalidatePath("/room-types");
    return ok({ id });
  } catch (err) {
    return toActionError(err);
  }
}

// ---- Room-type photo upload (admin only) ------------------------------------

const PHOTO_BUCKET = "travelers-inn-room-photos";
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

// Uploads a single photo and returns its public URL plus the storage object's
// path. Kept separate from saveRoomType so that action stays a clean
// Zod-parsed JSON mutation; the result rides along in the form's `photos`
// field array on save. Returning `storage_path` (not just the URL) lets
// syncPhotos hard-delete the underlying object when a photo is removed from
// the gallery — see the comment there for why that matters.
export async function uploadRoomTypePhoto(
  formData: FormData
): Promise<ActionResult<{ url: string; storage_path: string }>> {
  try {
    await requireRole(["admin"]);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("No file provided.");
    if (file.size > MAX_PHOTO_BYTES) return fail("Image must be 5 MB or smaller.");
    const ext = ALLOWED_IMAGE_TYPES[file.type];
    if (!ext) return fail("Use a JPEG, PNG, or WebP image.");

    const supabase = await createClient();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return fail(error.message);

    const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    return ok({ url: data.publicUrl, storage_path: path });
  } catch (err) {
    return toActionError(err);
  }
}

// ---- Rooms ------------------------------------------------------------------

// Create/edit is admin-only; status changes are done via updateRoomStatus.
export async function saveRoom(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin"]);
    const parsed = roomSchema.parse(input);
    const supabase = await createClient();

    // `status` is absent on purpose — see roomSchema. An insert takes the
    // column's `vacant` default; an update leaves whatever the stay lifecycle
    // and housekeeping have put there untouched.
    const row = {
      room_type_id: parsed.room_type_id,
      label: parsed.label,
      notes: parsed.notes || null,
    };

    let id: string;
    if (parsed.id) {
      const { data, error } = await supabase
        .from("rooms")
        .update(row)
        .eq("id", parsed.id)
        .select("id")
        .single();
      if (error) return fail(error.message);
      id = data.id;
    } else {
      const { data, error } = await supabase.from("rooms").insert(row).select("id").single();
      if (error) return fail(error.message);
      id = data.id;
    }

    await logAudit({
      actorId: user.id,
      action: parsed.id ? "room.update" : "room.create",
      entity: "room",
      entityId: id,
      diff: row,
    });
    revalidatePath("/rooms");
    return ok({ id });
  } catch (err) {
    return toActionError(err);
  }
}

const ROOM_IN_USE =
  "This room has booking history, so it can't be deleted — that would destroy the bookings. " +
  "Set its status to Out of service instead.";

// Hard delete, admin only (front desk may only change housekeeping status).
//
// `bookings.room_id` is ON DELETE RESTRICT, so a room that has ever been booked
// simply cannot be removed — that's the guarantee, and it's the database's, not
// this function's. The count query below exists only to turn a raw FK violation
// into a sentence a receptionist can act on; a booking inserted between the
// count and the delete still trips 23503, which maps to the same message. So
// this is really "delete a room created by mistake", which is the only delete
// that can't lose history.
//
// `feedback.room_id` is ON DELETE CASCADE, so guest feedback left for the room
// goes with it. That's flagged in the confirm dialog and the count is recorded
// in the audit entry, since the rows themselves won't be there to count later.
export async function deleteRoom(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin"]);
    const supabase = await createClient();

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("label")
      .eq("id", id)
      .maybeSingle();
    if (roomError) return fail(roomError.message);
    if (!room) return fail("That room no longer exists.");

    const { count: bookingCount, error: countError } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("room_id", id);
    if (countError) return fail(countError.message);
    if ((bookingCount ?? 0) > 0) return fail(ROOM_IN_USE);

    const { count: feedbackCount } = await supabase
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("room_id", id);

    // `.select()` on the delete so a row the RLS policy declines to touch is
    // reported instead of returning "deleted" for a no-op.
    const { data: deleted, error } = await supabase
      .from("rooms")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return fail(error.code === "23503" ? ROOM_IN_USE : error.message);
    if (!deleted || deleted.length === 0) return fail("That room could not be deleted.");

    await logAudit({
      actorId: user.id,
      action: "room.delete",
      entity: "room",
      entityId: id,
      diff: { label: room.label, feedback_deleted: feedbackCount ?? 0 },
    });
    revalidatePath("/rooms");
    return ok({ id });
  } catch (err) {
    return toActionError(err);
  }
}

// ---- Housekeeping (front desk too) ------------------------------------------
//
// `rooms.status` is written automatically by the stay lifecycle: check-in sets
// `occupied`, check-out sets `cleaning` (features/bookings/front-desk-actions).
// What follows are the only two transitions no booking can supply — whether
// the room has actually been cleaned, and whether it is physically usable.
// There is deliberately no general "set the status to anything" action any
// more: `occupied` and `cleaning` are conclusions, not opinions, and letting
// staff type them let the column contradict the bookings it was meant to
// summarise.

// cleaning → vacant. Refused from any other status, because from `occupied` it
// would evict an in-house guest from the board and from `out_of_service` it
// would quietly cancel the repair.
export async function markRoomClean(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin", "front_desk"]);
    const supabase = await createClient();

    const { data: room, error: readError } = await supabase
      .from("rooms")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (readError) return fail(readError.message);
    if (!room) return fail("That room no longer exists.");
    if (room.status === "out_of_service") {
      return fail("This room is out of service. Return it to service first.");
    }
    if (room.status !== "cleaning") return fail("Only a room being cleaned can be marked ready.");

    const { error } = await supabase.from("rooms").update({ status: "vacant" }).eq("id", id);
    if (error) return fail(error.message);
    await logAudit({
      actorId: user.id,
      action: "room.mark_clean",
      entity: "room",
      entityId: id,
      diff: { status: "vacant" },
    });
    revalidatePath("/rooms");
    return ok({ id });
  } catch (err) {
    return toActionError(err);
  }
}

// Out of service and back. Taking a room out is always allowed — a burst pipe
// doesn't wait for the guest to leave, and this is the one status the booking
// engine actually reads (every availability function filters on
// `status <> 'out_of_service'`), so it has to be reachable at any moment.
//
// Coming BACK is where the status has to be rebuilt rather than remembered:
// the old value was thrown away when the room went out, and the truth is in
// the bookings. A guest checked in while the room was out of service (staff
// moved them, then the repair finished) means it's occupied; otherwise the act
// of returning it to service is itself the statement that it's ready.
export async function setRoomOutOfService(
  id: string,
  out: boolean
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin", "front_desk"]);
    const supabase = await createClient();

    let status: RoomStatus = "out_of_service";
    if (!out) {
      const { data: inHouse } = await supabase
        .from("bookings")
        .select("id")
        .eq("room_id", id)
        .eq("status", "checked_in")
        .limit(1);
      status = (inHouse ?? []).length > 0 ? "occupied" : "vacant";
    }

    const { data: updated, error } = await supabase
      .from("rooms")
      .update({ status })
      .eq("id", id)
      .select("id");
    if (error) return fail(error.message);
    if (!updated || updated.length === 0) return fail("That room no longer exists.");

    await logAudit({
      actorId: user.id,
      action: out ? "room.out_of_service" : "room.back_in_service",
      entity: "room",
      entityId: id,
      diff: { status },
    });
    revalidatePath("/rooms");
    return ok({ id });
  } catch (err) {
    return toActionError(err);
  }
}
