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

// Staff-side read under RLS.
export async function getSettings(): Promise<SettingsMap> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key, value");
  return toMap(data);
}

// Portal-side read. The portal is anonymous and already reads through the admin
// client (see features/portal/repository.ts); this keeps that one pattern.
export async function getPublicSettings(): Promise<SettingsMap> {
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("key, value").eq("is_public", true);
  return toMap(data);
}
