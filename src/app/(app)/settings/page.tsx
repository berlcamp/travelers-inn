import type { Metadata } from "next";
import { pageRole } from "@/lib/auth/guards";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getSettings } from "@/features/settings/repository";
import { SettingsForm } from "@/features/settings/components/settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const allowed = await pageRole(["admin"]);
  if (!allowed) return <AccessDenied requires={["admin"]} />;
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
