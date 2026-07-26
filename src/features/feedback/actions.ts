"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { feedbackSchema } from "./schemas";

// Public, no-login submission. Goes through the admin client so
// fn_submit_feedback stays off the anon grant — the table itself is never
// reachable from the browser.
export async function submitFeedback(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = feedbackSchema.parse(input);
    const admin = createAdminClient();

    const { data, error } = await admin.rpc("fn_submit_feedback", {
      p_room_id: parsed.room_id,
      p_rating: parsed.rating,
      p_comment: parsed.comment || "",
      p_guest_name: parsed.guest_name || "",
    });
    if (error) return fail(error.message);

    const row = (Array.isArray(data) ? data[0] : data) as { id: string } | null;
    if (!row) return fail("We couldn't save your feedback. Please try again.");

    // Not yet a live route (B5 adds the staff /feedbacks page) — harmless to
    // revalidate ahead of time so that page is fresh from day one.
    revalidatePath("/feedbacks");
    return ok({ id: row.id });
  } catch (err) {
    return toActionError(err);
  }
}
