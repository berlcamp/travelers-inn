import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";
import { getSettings } from "@/features/settings/repository";
import { SettingsForm } from "@/features/settings/components/settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireRole(["admin"]);
  const settings = await getSettings();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Payment details shown to guests, the deposit rate, and the inn's map location."
      />
      <SettingsForm settings={settings} />
    </div>
  );
}
