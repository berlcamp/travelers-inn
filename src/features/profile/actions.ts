"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { profileSchema } from "./schemas";

/**
 * Edit your own display name. Every signed-in staff member may do this, so the
 * guard is `requireUser` rather than `requireRole`.
 *
 * The write goes through `fn_update_my_profile`, which picks the row by
 * `auth.uid()` — this action never sends an id, so there is nothing to forge.
 * `profiles` has no self-update policy on purpose; see the migration for why
 * widening one would have handed `is_active` and `email` to their subject.
 */
export async function updateMyProfile(input: unknown): Promise<ActionResult<{ fullName: string }>> {
  try {
    const user = await requireUser();
    const parsed = profileSchema.parse(input);

    // Nothing changed — don't write a row or an audit entry for a no-op save.
    if (parsed.full_name === user.fullName) return ok({ fullName: user.fullName });

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("fn_update_my_profile", {
      p_full_name: parsed.full_name,
    });
    if (error) return fail(error.message);

    await logAudit({
      actorId: user.id,
      action: "profile.update",
      entity: "profiles",
      entityId: user.id,
      diff: { full_name: { from: user.fullName, to: parsed.full_name } },
    });

    // The name is drawn in the header on every staff page, so the whole app
    // shell is stale, not just this route.
    revalidatePath("/", "layout");
    return ok({ fullName: data?.full_name ?? parsed.full_name });
  } catch (err) {
    return toActionError(err);
  }
}
