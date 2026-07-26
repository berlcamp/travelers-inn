"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/shared/form-fields";
import { saveSettings } from "@/features/settings/actions";
import {
  settingsSchema,
  type SettingsFormValues,
  type SettingsInput,
} from "@/features/settings/schemas";
import type { SettingsMap } from "@/features/settings/repository";

export function SettingsForm({ settings }: { settings: SettingsMap }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<SettingsFormValues, unknown, SettingsInput>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { ...settings },
  });

  function onSubmit(values: SettingsInput) {
    startTransition(async () => {
      const result = await saveSettings(values);
      if (result.ok) {
        toast.success("Settings saved.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-2xl flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Deposit</h2>
        <FormInput
          control={form.control}
          name="deposit_percent"
          label="Deposit percent"
          description="Portion of the total a portal guest pays up front."
          type="number"
          min={0}
          max={100}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">GCash</h2>
        <FormInput control={form.control} name="gcash_name" label="Account name" />
        <FormInput control={form.control} name="gcash_number" label="GCash number" />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Bank transfer</h2>
        <FormInput control={form.control} name="bank_name" label="Bank name" />
        <FormInput control={form.control} name="bank_account_name" label="Account name" />
        <FormInput control={form.control} name="bank_account_number" label="Account number" />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Location</h2>
        <FormInput
          control={form.control}
          name="inn_address"
          label="Address"
          description="Shown beside the map on the public site."
        />
        <div className="grid grid-cols-2 gap-3">
          <FormInput control={form.control} name="inn_map_lat" label="Latitude" />
          <FormInput control={form.control} name="inn_map_lng" label="Longitude" />
        </div>
      </section>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
