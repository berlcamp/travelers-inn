"use client";

import { useWatch, type Control } from "react-hook-form";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormInput, FormSelect } from "@/components/shared/form-fields";
import { TIER_KINDS, TIER_KIND_LABELS, type RoomTypeFormValues } from "@/features/rooms/schemas";

const kindOptions = TIER_KINDS.map((k) => ({ value: k, label: TIER_KIND_LABELS[k] }));

export function TierRow({
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
