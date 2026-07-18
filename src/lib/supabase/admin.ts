import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

// Service-role client — bypasses RLS. Server-only: importing this from a
// "use client" module must fail, hence the server-only env var name.
// Use only where RLS cannot express the need (invite validation, audit writes,
// the public portal's controlled booking insert).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Fail loudly on a missing key. Without this the client is built with
  // `undefined`, every request 401s, and logAudit() — which deliberately never
  // throws — swallows it, so the audit trail silently stops being written.
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client misconfigured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set (see .env.example)."
    );
  }

  return createSupabaseClient<Database, "booking">(url, serviceRoleKey, {
    db: { schema: "booking" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
