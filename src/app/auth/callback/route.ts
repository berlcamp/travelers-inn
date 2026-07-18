import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth callback: exchanges the code, then enforces the invite gate.
// fn_claim_invitation() provisions the profile + role when a live invitation
// matches the email (or bootstraps the first user as admin); without one the
// user is signed out (scope local — the shared Supabase project serves other
// apps too).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: profile } = user
        ? await supabase.from("profiles").select("is_active").eq("id", user.id).maybeSingle()
        : { data: null };

      if (profile) {
        if (!profile.is_active) {
          await supabase.auth.signOut({ scope: "local" });
          return NextResponse.redirect(`${origin}/login?error=deactivated`);
        }
      } else {
        const { data: claimed } = await supabase.rpc("fn_claim_invitation");
        if (!claimed) {
          await supabase.auth.signOut({ scope: "local" });
          return NextResponse.redirect(`${origin}/login?error=uninvited`);
        }
      }

      // Only allow same-origin relative redirects.
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
