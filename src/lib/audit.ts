import { createAdminClient } from "@/lib/supabase/admin";

export type AuditEntry = {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  diff?: unknown;
};

// Append-only audit write. Deliberately never throws: a failed audit insert
// must not break the user-facing action. Uses the admin client so the write
// succeeds regardless of the actor's RLS scope.
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("audit_logs").insert({
      actor_id: entry.actorId ?? null,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      diff: (entry.diff ?? null) as never,
    });
  } catch (err) {
    console.error("[audit] failed to write audit log", err);
  }
}
