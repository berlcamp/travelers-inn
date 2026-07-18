"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// RHF-bound wrappers over the base-nova Field family. One Zod schema drives
// both the form resolver and the server action.

type BaseProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
};

export function FormInput<T extends FieldValues>({
  control,
  name,
  label,
  description,
  ...inputProps
}: BaseProps<T> & Omit<React.ComponentProps<typeof Input>, "name">) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            id={name}
            {...inputProps}
            {...field}
            value={field.value ?? ""}
            aria-invalid={fieldState.invalid || undefined}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
        </Field>
      )}
    />
  );
}

export function FormTextarea<T extends FieldValues>({
  control,
  name,
  label,
  description,
  ...textareaProps
}: BaseProps<T> & Omit<React.ComponentProps<typeof Textarea>, "name">) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Textarea
            id={name}
            {...textareaProps}
            {...field}
            value={field.value ?? ""}
            aria-invalid={fieldState.invalid || undefined}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
        </Field>
      )}
    />
  );
}

// Boolean flags on reference data ("Active", …). The label sits beside the box.
export function FormCheckbox<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
}: BaseProps<T> & { disabled?: boolean }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <div className="flex items-center gap-2">
            <Checkbox
              id={name}
              checked={Boolean(field.value)}
              onCheckedChange={(checked) => field.onChange(checked)}
              disabled={disabled}
              aria-invalid={fieldState.invalid || undefined}
            />
            <FieldLabel htmlFor={name} className="mb-0">
              {label}
            </FieldLabel>
          </div>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
        </Field>
      )}
    />
  );
}

export type SelectOption = { value: string; label: string };

export function FormSelect<T extends FieldValues>({
  control,
  name,
  label,
  description,
  options,
  placeholder = "Select…",
  disabled,
}: BaseProps<T> & {
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Select
            items={options}
            value={field.value ?? null}
            onValueChange={(value) => field.onChange(value ?? null)}
            disabled={disabled}
          >
            <SelectTrigger id={name} aria-invalid={fieldState.invalid || undefined}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
        </Field>
      )}
    />
  );
}
