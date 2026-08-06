"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/shared/form-fields";
import { SectionCard } from "@/components/shared/section-card";
import { updateMyProfile } from "@/features/profile/actions";
import {
  profileSchema,
  type ProfileFormValues,
  type ProfileInput,
} from "@/features/profile/schemas";

export function ProfileForm({ fullName }: { fullName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<ProfileFormValues, unknown, ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: fullName },
  });

  function onSubmit(values: ProfileInput) {
    startTransition(async () => {
      const result = await updateMyProfile(values);
      if (result.ok) {
        toast.success("Profile updated.");
        // The name in the header comes from the layout, so a refresh is what
        // makes the change visible everywhere rather than just in this field.
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <SectionCard title="Your details" contentClassName="flex flex-col gap-3 pt-4">
        <FormInput
          control={form.control}
          name="full_name"
          label="Display name"
          description="Shown in the header, on the bookings you take, and in reports."
          autoComplete="name"
        />
      </SectionCard>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
