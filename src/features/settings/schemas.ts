import { z } from "zod";

// Every configurable key. Adding one here + a row in the migration is all it
// takes for it to appear in the admin form.
export const SETTING_KEYS = [
  "gcash_name",
  "gcash_number",
  "bank_name",
  "bank_account_name",
  "bank_account_number",
  "deposit_percent",
  "inn_address",
  "inn_map_lat",
  "inn_map_lng",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

// Sentinel seeded for values the operator must supply after deploy. The map
// section stays hidden while any of its values still holds this.
export const UNSET = "TODO_REPLACE";

export function isSet(value: string | undefined | null): boolean {
  return Boolean(value) && value !== UNSET;
}

export const settingsSchema = z.object({
  gcash_name: z.string().trim().max(120),
  gcash_number: z.string().trim().max(40),
  bank_name: z.string().trim().max(120),
  bank_account_name: z.string().trim().max(120),
  bank_account_number: z.string().trim().max(60),
  deposit_percent: z.coerce.number().min(0, "Must be ≥ 0").max(100, "Must be ≤ 100"),
  inn_address: z.string().trim().max(300),
  inn_map_lat: z.string().trim().max(40),
  inn_map_lng: z.string().trim().max(40),
});
export type SettingsFormValues = z.input<typeof settingsSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;

export const SETTING_LABELS: Record<SettingKey, string> = {
  gcash_name: "GCash account name",
  gcash_number: "GCash number",
  bank_name: "Bank name",
  bank_account_name: "Bank account name",
  bank_account_number: "Bank account number",
  deposit_percent: "Deposit percent",
  inn_address: "Inn address",
  inn_map_lat: "Map latitude",
  inn_map_lng: "Map longitude",
};
