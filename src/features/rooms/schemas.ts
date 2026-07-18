import { z } from "zod";

// One schema per entity drives both the RHF resolver and the server action.

export const roomTypeSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  capacity: z.coerce.number().int().min(1, "At least 1").max(20),
  nightly_rate: z.coerce.number().min(0, "Must be ≥ 0"),
  // Optional: some types don't offer hourly stays. Empty string / null clears it.
  hourly_rate: z.coerce
    .number()
    .min(0, "Must be ≥ 0")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  is_active: z.boolean().default(true),
});
// z.coerce on numeric fields: FormInput hands react-hook-form the input's
// STRING value, so the form is typed with the INPUT type (z.input) and the
// action receives the coerced OUTPUT type (z.infer). See prime-hrm M3.2-T6.
export type RoomTypeFormValues = z.input<typeof roomTypeSchema>;
export type RoomTypeInput = z.infer<typeof roomTypeSchema>;

export const ROOM_STATUSES = ["vacant", "occupied", "cleaning", "out_of_service"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  vacant: "Vacant",
  occupied: "Occupied",
  cleaning: "Cleaning",
  out_of_service: "Out of service",
};

export const roomSchema = z.object({
  id: z.string().uuid().optional(),
  room_type_id: z.string().uuid("Select a room type"),
  label: z.string().trim().min(1, "Label is required").max(40),
  status: z.enum(ROOM_STATUSES).default("vacant"),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
export type RoomFormValues = z.input<typeof roomSchema>;
export type RoomInput = z.infer<typeof roomSchema>;
