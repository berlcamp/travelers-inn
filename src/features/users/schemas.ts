import { z } from "zod";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { Database } from "@/types/database.types";

export type UserRole = Database["booking"]["Enums"]["user_role"];
export type InvitationStatus = Database["booking"]["Enums"]["invitation_status"];

export const USER_ROLES = ["admin", "front_desk"] as const;

// One definition, in lib/auth/roles — the access-denied panel, the app header
// and this form all name roles the same way. Re-exported so the five callers
// here keep their existing import.
export { ROLE_LABELS };

export const ROLE_OPTIONS = USER_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

// Mirrors booking.invitations.expires_at's default (now() + 14 days). Set
// explicitly on write so re-inviting an existing pending row renews it instead
// of leaving the original (possibly already expired) window in place.
export const INVITE_TTL_DAYS = 14;

export const inviteSchema = z.object({
  // Lowercased here because every email comparison downstream is
  // case-insensitive by way of lower(): profiles' unique index, invitations'
  // pending-email index, and fn_claim_invitation's lookup at sign-in.
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  role: z.enum(USER_ROLES),
});
export type InviteFormValues = z.input<typeof inviteSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
