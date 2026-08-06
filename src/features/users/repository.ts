import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";
import type { UserRole } from "./schemas";

export type Profile = Database["booking"]["Tables"]["profiles"]["Row"];
export type Invitation = Database["booking"]["Tables"]["invitations"]["Row"];

export type StaffMember = Profile & { roles: UserRole[] };
// `isExpired` is derived here rather than in the table so the client renders a
// pure function of its props: a still-`pending` row whose window has closed is
// dead as far as fn_claim_invitation() is concerned, but nothing rewrites its
// status column when the clock passes it.
export type InvitationRow = Invitation & { invitedByName: string | null; isExpired: boolean };

// Reads run under RLS as the signed-in user; profiles/user_roles fall back to
// fn_is_admin() for anything beyond the caller's own row, and invitations are
// admin-only outright — so the page guards with requireRole(["admin"]) and a
// non-admin would simply see nothing here.

// profiles and user_roles both hang off auth.users but have no FK between
// themselves, so PostgREST cannot embed one in the other. Two queries, joined
// in JS.
export async function listStaff(): Promise<StaffMember[]> {
  const supabase = await createClient();
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name"),
    supabase.from("user_roles").select("user_id, role"),
  ]);

  const byUser = new Map<string, UserRole[]>();
  for (const row of roles ?? []) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.role]);
  }
  return (profiles ?? []).map((p) => ({ ...p, roles: byUser.get(p.id) ?? [] }));
}

// invited_by references auth.users (not booking.profiles), so the inviter's
// name needs its own lookup — same no-embeddable-FK situation as above.
export async function listInvitations(): Promise<InvitationRow[]> {
  const supabase = await createClient();
  const { data: invitations } = await supabase
    .from("invitations")
    .select("*")
    .order("created_at", { ascending: false });
  if (!invitations || invitations.length === 0) return [];

  const inviterIds = [...new Set(invitations.map((i) => i.invited_by).filter(Boolean))] as string[];
  const { data: inviters } = inviterIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", inviterIds)
    : { data: [] };

  const nameById = new Map((inviters ?? []).map((p) => [p.id, p.full_name]));
  const now = Date.now();
  return invitations.map((i) => ({
    ...i,
    invitedByName: i.invited_by ? (nameById.get(i.invited_by) ?? null) : null,
    isExpired: i.status === "pending" && new Date(i.expires_at).getTime() <= now,
  }));
}
