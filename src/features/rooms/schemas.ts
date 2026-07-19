import { z } from "zod";

// One schema per entity drives both the RHF resolver and the server action.

export const TIER_KINDS = ["block", "overnight"] as const;
export type TierKind = (typeof TIER_KINDS)[number];

export const TIER_KIND_LABELS: Record<TierKind, string> = {
  block: "Day-use block",
  overnight: "Overnight",
};

// A single rate tier row inside the room-type form. `duration_hours` is required
// for block tiers (3h/12h) and cleared for overnight; the refine enforces it.
export const rateTierSchema = z
  .object({
    id: z.string().uuid().optional(),
    label: z.string().trim().min(1, "Label is required").max(40),
    kind: z.enum(TIER_KINDS),
    duration_hours: z.coerce
      .number()
      .int()
      .min(1, "Must be ≥ 1")
      .max(240)
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
    price: z.coerce.number().min(0, "Must be ≥ 0"),
  })
  .refine((t) => t.kind !== "block" || (t.duration_hours != null && t.duration_hours > 0), {
    message: "Day-use blocks need a duration in hours",
    path: ["duration_hours"],
  });
export type RateTierFormValues = z.input<typeof rateTierSchema>;
export type RateTierInput = z.infer<typeof rateTierSchema>;

export const roomTypeSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Name is required").max(80),
    description: z.string().trim().max(500).optional().or(z.literal("")),
    base_occupancy: z.coerce.number().int().min(1, "At least 1").max(50),
    max_occupancy: z.coerce.number().int().min(1, "At least 1").max(50),
    excess_person_rate: z.coerce.number().min(0, "Must be ≥ 0"),
    tiers: z.array(rateTierSchema).min(1, "Add at least one rate tier"),
    is_active: z.boolean().default(true),
  })
  .refine((t) => t.max_occupancy >= t.base_occupancy, {
    message: "Max must be ≥ base occupancy",
    path: ["max_occupancy"],
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
