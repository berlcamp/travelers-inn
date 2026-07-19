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

  // Supabase appends error/error_description to the redirect when the provider
  // handshake itself fails (e.g. provider disabled, redirect URL not
  // allowlisted). Surface it instead of collapsing into a generic failure.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");

  const failAuth = (detail: string) => {
    console.error(`[auth/callback] sign-in failed: ${detail}`, { origin });
    const url = new URL(`${origin}/login`);
    url.searchParams.set("error", "auth");
    url.searchParams.set("detail", detail.slice(0, 300));
    return NextResponse.redirect(url);
  };

  if (providerError) {
    return failAuth(providerError);
  }

  if (!code) {
    return failAuth("No authorization code returned from the identity provider.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return failAuth(`Code exchange failed: ${error.message}`);
  }

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
