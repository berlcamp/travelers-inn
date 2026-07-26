import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SETTING_KEYS, type SettingKey } from "./schemas";

export type SettingsMap = Record<SettingKey, string>;

function toMap(rows: { key: string; value: string }[] | null): SettingsMap {
  const map = Object.fromEntries(SETTING_KEYS.map((k) => [k, ""])) as SettingsMap;
  for (const row of rows ?? []) {
    if ((SETTING_KEYS as readonly string[]).includes(row.key)) {
      map[row.key as SettingKey] = row.value;
    }
  }
  return map;
}

// Staff-side read under RLS. Per-request cached (same convention as
// getCurrentUser in lib/auth/guards.ts) so multiple readers within one
// render share a single query.
export const getSettings = cache(async (): Promise<SettingsMap> => {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key, value");
  return toMap(data);
});

// Portal-side read. The portal is anonymous and already reads through the admin
// client (see features/portal/repository.ts); this keeps that one pattern.
// Per-request cached: both the portal layout (footer address) and the portal
// home page (Find us section) call this on every request, so without caching
// each request to `/` would run the query twice.
export const getPublicSettings = cache(async (): Promise<SettingsMap> => {
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("key, value").eq("is_public", true);
  return toMap(data);
});
