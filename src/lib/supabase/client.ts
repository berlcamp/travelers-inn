import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

// Client components only (browser session, RLS-scoped, `booking` schema).
export function createClient() {
  return createBrowserClient<Database, "booking">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "booking" } }
  );
}
