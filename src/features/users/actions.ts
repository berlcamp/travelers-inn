"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { inviteSchema, INVITE_TTL_DAYS, USER_ROLES, type UserRole } from "./schemas";

// Every mutation here is admin-only and refuses to touch the caller's own row.
// That self-guard is also what keeps the inn from being locked out: since only
// an admin can get this far, the acting admin always survives as an active
// admin no matter who they demote or deactivate.

function expiryFromNow(): string {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Whitelists an email. There is no email delivery: the invitee signs in with
// Google and fn_claim_invitation() provisions their profile + role from the
// live invitation, so the admin just tells them to sign in.
export async function inviteStaff(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin"]);
    const parsed = inviteSchema.parse(input);
    const supabase = await createClient();

    // profiles.email is written lowercased by fn_claim_invitation, and the
    // schema lowercases here, so this is an exact match.
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", parsed.email)
      .maybeSingle();
    if (existing) return fail("That email already belongs to a staff member.");

    // Only one pending invitation per email is allowed (partial unique index on
    // lower(email)), so an existing one is renewed rather than duplicated.
    // Matched case-insensitively in JS to cover rows written outside this form.
    const { data: pendingRows, error: pendingError } = await supabase
      .from("invitations")
      .select("id, email")
      .eq("status", "pending");
    if (pendingError) return fail(pendingError.message);

    const pending = (pendingRows ?? []).find((r) => r.email.toLowerCase() === parsed.email);
    const expires_at = expiryFromNow();

    if (pending) {
      const { error } = await supabase
        .from("invitations")
        .update({ role: parsed.role, expires_at })
        .eq("id", pending.id);
      if (error) return fail(error.message);
      await logAudit({
        actorId: user.id,
        action: "invitation.renew",
        entity: "invitation",
        entityId: pending.id,
        diff: { email: parsed.email, role: parsed.role, expires_at },
      });
      revalidatePath("/users");
      return ok({ id: pending.id });
    }

    const { data, error } = await supabase
      .from("invitations")
      .insert({
        email: parsed.email,
        role: parsed.role,
        invited_by: user.id,
        expires_at,
      })
      .select("id")
      .single();
    if (error) return fail(error.message);

    await logAudit({
      actorId: user.id,
      action: "invitation.create",
      entity: "invitation",
      entityId: data.id,
      diff: { email: parsed.email, role: parsed.role, expires_at },
    });
    revalidatePath("/users");
    return ok({ id: data.id });
  } catch (err) {
    return toActionError(err);
  }
}

export async function revokeInvitation(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin"]);
    const supabase = await createClient();

    // Scoped to pending so an already-accepted invitation can't be rewritten
    // (the profile it created would stay regardless).
    const { data, error } = await supabase
      .from("invitations")
      .update({ status: "revoked" })
      .eq("id", id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("That invitation is no longer pending.");

    await logAudit({
      actorId: user.id,
      action: "invitation.revoke",
      entity: "invitation",
      entityId: id,
    });
    revalidatePath("/users");
    return ok({ id });
  } catch (err) {
    return toActionError(err);
  }
}

// The app treats a staff member as holding exactly one role (fn_claim_invitation
// assigns one; hasRole() short-circuits on admin), even though user_roles can
// hold several — so this replaces the whole set. Insert first, then drop the
// others, so the member is never momentarily role-less.
export async function setStaffRole(
  userId: string,
  role: UserRole
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin"]);
    if (userId === user.id) return fail("You can't change your own role.");
    if (!USER_ROLES.includes(role)) return fail("Invalid role.");
    const supabase = await createClient();

    const { error: insertError } = await supabase
      .from("user_roles")
      .upsert({ user_id: userId, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
    if (insertError) return fail(insertError.message);

    const { error: deleteError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .neq("role", role);
    if (deleteError) return fail(deleteError.message);

    await logAudit({
      actorId: user.id,
      action: "user.set_role",
      entity: "profile",
      entityId: userId,
      diff: { role },
    });
    revalidatePath("/users");
    return ok({ id: userId });
  } catch (err) {
    return toActionError(err);
  }
}

// Deactivating is the off switch for staff access: requireUser() bounces a
// profile with is_active = false back to /login on the next request. Rows are
// never deleted — audit logs and bookings reference the actor.
export async function setStaffActive(
  userId: string,
  active: boolean
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin"]);
    if (userId === user.id && !active) return fail("You can't deactivate your own account.");
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("profiles")
      .update({ is_active: active })
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("That staff member no longer exists.");

    await logAudit({
      actorId: user.id,
      action: active ? "user.activate" : "user.deactivate",
      entity: "profile",
      entityId: userId,
      diff: { is_active: active },
    });
    revalidatePath("/users");
    return ok({ id: userId });
  } catch (err) {
    return toActionError(err);
  }
}
