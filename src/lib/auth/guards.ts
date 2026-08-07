import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { roleMatches, type UserRole } from "@/lib/auth/roles";

// Re-exported so callers keep importing their guards from one place. The
// predicate itself lives in ./roles because client components need it and this
// module reaches for next/headers — see the note there.
export { roleMatches, type UserRole };

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  isActive: boolean;
  roles: UserRole[];
};

// Per-request cached identity: auth user + profile + role assignments.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("email, full_name, avatar_url, is_active")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);
  if (!profile) return null;

  return {
    id: user.id,
    email: profile.email,
    fullName: profile.full_name,
    avatarUrl: profile.avatar_url,
    isActive: profile.is_active,
    roles: (roles ?? []).map((r) => r.role),
  };
});

// For pages/layouts: redirects to login when unauthenticated or deactivated.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || !user.isActive) redirect("/login");
  return user;
}

// Admin passes every check.
export function hasRole(user: CurrentUser, role: UserRole): boolean {
  return roleMatches(user.roles, [role]);
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * For SERVER ACTIONS: throws when none of the roles match, so the action's
 * catch turns it into an ActionResult error (see lib/action-result.ts).
 *
 * Do NOT use this in a page. A thrown error in a Server Component renders the
 * error boundary — a bare "something went wrong" screen with a 500 — which
 * tells a front-desk user who wandered onto /reports that the app is broken
 * rather than that the page is not theirs. Pages use `pageRole` below.
 */
export async function requireRole(roles: UserRole[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roleMatches(user.roles, roles)) throw new ForbiddenError();
  return user;
}

/**
 * For PAGES: the signed-in user, or `null` when their roles don't allow this
 * page — a UI state, not an exception. Callers render `<AccessDenied />`:
 *
 *     const user = await pageRole(["admin"]);
 *     if (!user) return <AccessDenied requires={["admin"]} />;
 *
 * Still redirects to /login when signed out or deactivated, because that is a
 * different answer ("who are you?") from this one ("not you").
 *
 * Returning null rather than throwing is deliberate: Next sanitises errors in
 * production — the boundary receives a generic message and a digest, so a
 * ForbiddenError is indistinguishable there from a genuine crash, and cannot
 * be rendered as a friendly panel.
 */
export async function pageRole(roles: UserRole[]): Promise<CurrentUser | null> {
  const user = await requireUser();
  return roleMatches(user.roles, roles) ? user : null;
}
