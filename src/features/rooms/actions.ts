"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { roomTypeSchema, roomSchema, ROOM_STATUSES, type RoomStatus } from "./schemas";

// ---- Room types (admin only) ------------------------------------------------

export async function saveRoomType(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin"]);
    const parsed = roomTypeSchema.parse(input);
    const supabase = await createClient();

    const row = {
      name: parsed.name,
      description: parsed.description || null,
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

// ---- Rooms ------------------------------------------------------------------

// Create/edit is admin-only; status changes are done via updateRoomStatus.
export async function saveRoom(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin"]);
    const parsed = roomSchema.parse(input);
    const supabase = await createClient();

    const row = {
      room_type_id: parsed.room_type_id,
      label: parsed.label,
      status: parsed.status,
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

// Housekeeping status change — allowed for front desk too.
export async function updateRoomStatus(
  id: string,
  status: RoomStatus
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin", "front_desk"]);
    if (!ROOM_STATUSES.includes(status)) return fail("Invalid status.");
    const supabase = await createClient();
    const { error } = await supabase.from("rooms").update({ status }).eq("id", id);
    if (error) return fail(error.message);
    await logAudit({
      actorId: user.id,
      action: "room.update_status",
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
