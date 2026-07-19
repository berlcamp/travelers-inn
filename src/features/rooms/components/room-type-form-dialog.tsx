"use client";

import { useRef, useState, useTransition } from "react";
import {
  useForm,
  useFieldArray,
  useWatch,
  type Control,
  type UseFormSetValue,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
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
import { FormInput, FormTextarea, FormCheckbox, FormSelect } from "@/components/shared/form-fields";
import {
  roomTypeSchema,
  TIER_KINDS,
  TIER_KIND_LABELS,
  type RoomTypeFormValues,
  type RoomTypeInput,
} from "@/features/rooms/schemas";
import { saveRoomType, uploadRoomTypePhoto } from "@/features/rooms/actions";
import type { RoomTypeWithTiers } from "@/features/rooms/repository";

const kindOptions = TIER_KINDS.map((k) => ({ value: k, label: TIER_KIND_LABELS[k] }));

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
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
  roomType?: RoomTypeWithTiers;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      <DialogTrigger render={trigger} />
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

          <PhotoField control={form.control} setValue={form.setValue} />

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

function TierRow({
  control,
  index,
  onRemove,
}: {
  control: Control<RoomTypeFormValues>;
  index: number;
  onRemove?: () => void;
}) {
  const kind = useWatch({ control, name: `tiers.${index}.kind` });
  const isBlock = kind === "block";

  return (
    <div className="border-border bg-muted/30 grid grid-cols-[1fr_auto] items-start gap-2 rounded-lg border p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <FormInput control={control} name={`tiers.${index}.label`} label="Label" placeholder="Overnight" />
        <FormSelect
          control={control}
          name={`tiers.${index}.kind`}
          label="Kind"
          options={kindOptions}
        />
        {isBlock ? (
          <FormInput
            control={control}
            name={`tiers.${index}.duration_hours`}
            label="Hours"
            type="number"
            min={1}
          />
        ) : (
          <div className="hidden sm:block" aria-hidden />
        )}
        <FormInput
          control={control}
          name={`tiers.${index}.price`}
          label="Price ₱"
          type="number"
          min={0}
          step="0.01"
        />
      </div>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground mt-6"
          aria-label="Remove tier"
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : (
        <span className="w-8" />
      )}
    </div>
  );
}

// Cover photo: uploads on select via the server action, stores the returned
// public URL in the form's `image_url` field, and previews it. Removing just
// clears the URL — the orphaned object is left in the bucket (see spec).
function PhotoField({
  control,
  setValue,
}: {
  control: Control<RoomTypeFormValues>;
  setValue: UseFormSetValue<RoomTypeFormValues>;
}) {
  const imageUrl = useWatch({ control, name: "image_url" });
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setUploading(true);
    const data = new FormData();
    data.set("file", file);
    const result = await uploadRoomTypePhoto(data);
    setUploading(false);
    if (result.ok) {
      setValue("image_url", result.data.url, { shouldDirty: true });
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Cover photo</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onPick}
      />
      {imageUrl ? (
        <div className="border-border relative w-full overflow-hidden rounded-lg border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Room cover" className="h-40 w-full object-cover" />
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="absolute right-2 top-2"
            aria-label="Remove photo"
            onClick={() => setValue("image_url", "", { shouldDirty: true })}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="text-muted-foreground h-40 w-full flex-col gap-2 border-dashed"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <>
              <Loader2 className="size-5 animate-spin" /> Uploading…
            </>
          ) : (
            <>
              <ImagePlus className="size-5" /> Upload a photo
              <span className="text-xs">JPEG, PNG, or WebP · up to 5 MB</span>
            </>
          )}
        </Button>
      )}
      {imageUrl ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Uploading…" : "Replace photo"}
        </Button>
      ) : null}
    </div>
  );
}
