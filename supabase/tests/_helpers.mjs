// Shared helpers for DB integration tests that run against the real local
// Supabase stack (`npm run db:start`). Uses password auth against local GoTrue
// to act as specific users (Google isn't available offline), matching the
// documented local-testing approach.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../../.env.local");

// Minimal .env parser — node doesn't load .env.local for plain scripts.
function loadEnv() {
  const raw = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase env in .env.local — run `npm run db:start` first.");
}

// These tests are destructive by design: every suite truncates bookings,
// payments, rooms, room_types, profiles, user_roles, invitations, audit_logs
// and feedback with the service-role key, which bypasses RLS. .env.local is
// also what the app itself reads, so it sometimes points at the HOSTED project
// — and on this SHARED project that would take other people's data with it.
// Refuse to run anywhere but a local stack; there is no flag to override this
// on purpose, because there is no good reason to want one.
{
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") {
    throw new Error(
      `Refusing to run destructive DB tests against ${SUPABASE_URL}.\n` +
        "These tests wipe the booking schema. Point NEXT_PUBLIC_SUPABASE_URL in " +
        ".env.local at the local stack (http://127.0.0.1:54621, see " +
        "`npm run db:start`) before running them."
    );
  }
}

// Service-role client bound to the `booking` schema. Bypasses RLS.
export function adminBooking() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    db: { schema: "booking" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Service-role client for auth.admin operations (schema-independent).
export function adminAuth() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const PASSWORD = "test-password-123";

// Create a confirmed auth user with Google-like metadata. Returns the user id.
export async function createUser(email, fullName) {
  const auth = adminAuth();
  const { data, error } = await auth.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, avatar_url: `https://example.test/${fullName}.png` },
  });
  if (error) throw error;
  return data.user.id;
}

// Return an anon-key client authenticated as `email` (booking schema), so
// rpc/table calls run with that user's auth.uid() under RLS.
export async function clientAs(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    db: { schema: "booking" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

// Wipe booking identity tables + all test auth users so each run starts fresh
// (the fn_claim_invitation bootstrap depends on an empty profiles table).
export async function resetIdentity() {
  const b = adminBooking();
  await b.from("user_roles").delete().not("id", "is", null);
  await b.from("profiles").delete().not("id", "is", null);
  await b.from("invitations").delete().not("id", "is", null);

  const auth = adminAuth();
  let page = 1;
  // Delete any users from prior runs so createUser() emails stay unique.
  for (;;) {
    const { data, error } = await auth.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) {
      if (u.email && u.email.endsWith("@test.local")) {
        await auth.auth.admin.deleteUser(u.id);
      }
    }
    if (data.users.length < 200) break;
    page += 1;
  }
}
