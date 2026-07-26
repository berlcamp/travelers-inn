"use client";

import { useState, useTransition } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import type { RoomTypeWithTiers } from "@/features/rooms/repository";
import { TierRow } from "./tier-row";
import { PhotosField } from "./photos-field";

function defaults(roomType?: RoomTypeWithTiers): RoomTypeFormValues {
  return {
    id: roomType?.id,
    name: roomType?.name ?? "",
    description: roomType?.description ?? "",
    image_url: roomType?.image_url ?? "",
    base_occupancy: roomType?.base_occupancy ?? 2,
    max_occupancy: roomType?.max_occupancy ?? 2,
    excess_person_rate: roomType ? Number(roomType.excess_person_rate) : 0,
    is_active: roomType?.is_active ?? true,
    photos:
      roomType?.room_type_photos.map((p) => ({
        id: p.id,
        url: p.url,
        storage_path: p.storage_path,
      })) ?? [],
    tiers:
      roomType && roomType.rate_tiers.length > 0
        ? roomType.rate_tiers.map((t) => ({
            id: t.id,
            label: t.label,
            kind: t.kind,
            duration_hours: t.duration_hours,
            price: Number(t.price),
          }))
        : [{ label: "Overnight", kind: "overnight", duration_hours: null, price: 0 }],
  };
}

export function RoomTypeFormDialog({
  trigger,
  roomType,
  open: openProp,
  onOpenChange,
}: {
  // Uncontrolled (own trigger) for the "Add" button; controlled (open/
  // onOpenChange, no trigger) when opened from a dropdown menu item — nesting a
  // DialogTrigger inside a Base UI Menu.Item makes the dialog flash shut as the
  // menu dismisses, so those callers drive `open` via state instead.
  trigger?: React.ReactElement<Record<string, unknown>>;
  roomType?: RoomTypeWithTiers;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [pending, startTransition] = useTransition();

  const form = useForm<RoomTypeFormValues, unknown, RoomTypeInput>({
    resolver: zodResolver(roomTypeSchema),
    defaultValues: defaults(roomType),
  });

  const tiers = useFieldArray({ control: form.control, name: "tiers" });

  function onSubmit(values: RoomTypeInput) {
    startTransition(async () => {
      const result = await saveRoomType(values);
      if (result.ok) {
        toast.success(roomType ? "Room type updated." : "Room type created.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{roomType ? "Edit room type" : "Add room type"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormInput control={form.control} name="name" label="Name" placeholder="Couple Room" />
          <FormTextarea
            control={form.control}
            name="description"
            label="Description"
            placeholder="Optional details shown to guests"
            rows={2}
          />

          <PhotosField control={form.control} />

          <div className="grid grid-cols-3 gap-3">
            <FormInput
              control={form.control}
              name="base_occupancy"
              label="Base guests"
              description="Covered by price"
              type="number"
              min={1}
            />
            <FormInput
              control={form.control}
              name="max_occupancy"
              label="Max guests"
              type="number"
              min={1}
            />
            <FormInput
              control={form.control}
              name="excess_person_rate"
              label="Excess ₱/head"
              description="Per night"
              type="number"
              min={0}
              step="0.01"
            />
          </div>

          {/* Rate tiers */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Rate tiers</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  tiers.append({ label: "", kind: "overnight", duration_hours: null, price: 0 })
                }
              >
                <Plus className="size-4" /> Add tier
              </Button>
            </div>
            {form.formState.errors.tiers?.root ? (
              <p className="text-destructive text-xs">
                {form.formState.errors.tiers.root.message}
              </p>
            ) : null}
            <div className="flex flex-col gap-3">
              {tiers.fields.map((field, i) => (
                <TierRow
                  key={field.id}
                  control={form.control}
                  index={i}
                  onRemove={tiers.fields.length > 1 ? () => tiers.remove(i) : undefined}
                />
              ))}
            </div>
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

