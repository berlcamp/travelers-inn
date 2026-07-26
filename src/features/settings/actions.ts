"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { settingsSchema } from "./schemas";

export async function saveSettings(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireRole(["admin"]);
    const parsed = settingsSchema.parse(input);
    const supabase = await createClient();

    const rows = Object.entries(parsed).map(([key, value]) => ({
      key,
      value: String(value),
      is_public: true,
    }));
    const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
    if (error) return fail(error.message);

    await logAudit({
      actorId: user.id,
      action: "settings.update",
      entity: "settings",
      diff: { keys: rows.map((r) => r.key) },
    });
    revalidatePath("/settings");
    revalidatePath("/");
    return ok({ count: rows.length });
  } catch (err) {
    return toActionError(err);
  }
}
