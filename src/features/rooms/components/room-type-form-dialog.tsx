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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormInput, FormTextarea, FormCheckbox } from "@/components/shared/form-fields";
import {
  roomTypeSchema,
  type RoomTypeFormValues,
  type RoomTypeInput,
} from "@/features/rooms/schemas";
import { saveRoomType } from "@/features/rooms/actions";
import type { RoomType } from "@/features/rooms/repository";

export function RoomTypeFormDialog({
  trigger,
  roomType,
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
  roomType?: RoomType;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const form = useForm<RoomTypeFormValues, unknown, RoomTypeInput>({
    resolver: zodResolver(roomTypeSchema),
    defaultValues: {
      id: roomType?.id,
      name: roomType?.name ?? "",
      description: roomType?.description ?? "",
      capacity: roomType?.capacity ?? 2,
      nightly_rate: roomType ? Number(roomType.nightly_rate) : 0,
      hourly_rate: roomType?.hourly_rate != null ? Number(roomType.hourly_rate) : null,
      is_active: roomType?.is_active ?? true,
    },
  });

  function onSubmit(values: RoomTypeInput) {
    startTransition(async () => {
      const result = await saveRoomType(values);
      if (result.ok) {
        toast.success(roomType ? "Room type updated." : "Room type created.");
        setOpen(false);
        form.reset(values);
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
          <DialogTitle>{roomType ? "Edit room type" : "Add room type"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormInput control={form.control} name="name" label="Name" placeholder="Deluxe Double" />
          <FormTextarea
            control={form.control}
            name="description"
            label="Description"
            placeholder="Optional details shown to guests"
            rows={2}
          />
          <div className="grid grid-cols-3 gap-3">
            <FormInput control={form.control} name="capacity" label="Capacity" type="number" min={1} />
            <FormInput
              control={form.control}
              name="nightly_rate"
              label="Nightly ₱"
              type="number"
              min={0}
              step="0.01"
            />
            <FormInput
              control={form.control}
              name="hourly_rate"
              label="Hourly ₱"
              type="number"
              min={0}
              step="0.01"
            />
          </div>
          <FormCheckbox control={form.control} name="is_active" label="Active (bookable)" />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
