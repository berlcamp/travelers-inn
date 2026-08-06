"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormInput, FormSelect } from "@/components/shared/form-fields";
import { inviteStaff } from "@/features/users/actions";
import {
  inviteSchema,
  ROLE_OPTIONS,
  type InviteFormValues,
  type InviteInput,
} from "@/features/users/schemas";

export function InviteDialog({
  trigger,
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const form = useForm<InviteFormValues, unknown, InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "front_desk" },
  });

  function onSubmit(values: InviteInput) {
    startTransition(async () => {
      const result = await inviteStaff(values);
      if (result.ok) {
        toast.success("Invitation sent. They can sign in with Google now.");
        form.reset({ email: "", role: "front_desk" });
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite staff</DialogTitle>
          <DialogDescription>
            The invitation lasts 14 days. Nothing is emailed — tell them to sign in with this Google
            account and their access is provisioned automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormInput
            control={form.control}
            name="email"
            label="Google email"
            type="email"
            placeholder="name@example.com"
          />
          <FormSelect control={form.control} name="role" label="Role" options={ROLE_OPTIONS} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Inviting…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
