import type { Database } from "@/types/database.types";

export type UserRole = Database["booking"]["Enums"]["user_role"];

/**
 * The single definition of "may this person do this". Admin passes every check.
 *
 * This lives apart from `guards.ts` on purpose, and the split is load-bearing:
 * `guards.ts` imports the Supabase *server* client (`next/headers`), so a
 * client component that imported this predicate from there would drag
 * server-only code into the browser bundle and fail the build. The sidebar is
 * a client component and needs exactly this function — the same one the page
 * guards use, so a menu item can never disagree with the page behind it.
 *
 * Takes bare roles rather than a CurrentUser for the same reason: the client
 * has the role list and nothing else.
 */
export function roleMatches(userRoles: UserRole[], allowed: UserRole[]): boolean {
  if (userRoles.includes("admin")) return true;
  return allowed.some((role) => userRoles.includes(role));
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  front_desk: "Front Desk",
};
