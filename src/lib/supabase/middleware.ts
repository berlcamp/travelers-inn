import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database.types";

// Paths reachable without a staff session. The public booking portal lives at
// "/", "/search", "/book" (added in M5) and "/feedback" (per-room guest
// feedback via printed QR code); "/login" and "/auth" are the staff sign-in
// surfaces. Note "/feedback" (portal, public) and "/feedbacks" (staff list,
// under (app)) are distinct routes — isPublicPath below only matches on an
// exact segment boundary, so this entry does not also expose the staff page.
const PUBLIC_PATHS = ["/login", "/auth", "/", "/search", "/book", "/feedback"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) =>
    p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)
  );
}

// Session refresh + route protection for src/proxy.ts (Next 16 replacement for
// middleware.ts). The Supabase project is SHARED with other apps, so the invite
// gate is profile-based: no active booking.profiles row = no staff access.
// fn_claim_invitation() covers users invited (or bootstrapped) after their
// auth.users row already existed. signOut uses scope "local" so other apps'
// sessions on the shared project are never revoked.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database, "booking">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "booking" },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between client creation and this call — the token refresh
  // must happen before any response is returned. getClaims() refreshes a
  // near-expiry session exactly as getUser() does.
  //
  // getClaims() verifies the token locally against the project's JWKS instead
  // of posting it to the Auth server: 23.2ms → 0.24ms measured on this stack,
  // and a full internet round trip on hosted Supabase. This runs on EVERY
  // request the matcher below covers — every page, every server action — so it
  // was the single most-repeated network call in the app. See the longer note
  // in lib/auth/guards.ts on why this doesn't weaken the access gate: that
  // gate is the `profiles.is_active` read a few lines down, which is still a
  // live database check on every request.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub ?? null;

  const { pathname } = request.nextUrl;

  const redirectWithCookies = (path: string) => {
    const url = request.nextUrl.clone();
    const [p, query] = path.split("?");
    url.pathname = p;
    url.search = query ? `?${query}` : "";
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => response.cookies.set(c));
    return response;
  };

  if (!userId) {
    if (!isPublicPath(pathname)) return redirectWithCookies("/login");
    return supabaseResponse;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) {
    // Invited (or first-user bootstrap) after the auth user already existed?
    // Claim provisions the profile. Otherwise this Google account has no staff
    // access on this app → sign out (scope local) and bounce to login.
    const { data: claimed } = await supabase.rpc("fn_claim_invitation");
    if (!claimed) {
      await supabase.auth.signOut({ scope: "local" });
      return redirectWithCookies("/login?error=uninvited");
    }
  } else if (!profile.is_active) {
    await supabase.auth.signOut({ scope: "local" });
    return redirectWithCookies("/login?error=deactivated");
  }

  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return redirectWithCookies("/dashboard");
  }

  return supabaseResponse;
}
