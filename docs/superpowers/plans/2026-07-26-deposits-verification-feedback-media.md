# Deposits, Verification, Feedback & Media — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deposit-gated portal booking with staff verification, per-room feedback QR codes with an admin feedbacks page, multi-photo room types with a portal gallery, and a Google Map of the inn.

**Architecture:** Four independently shippable parts on the existing Next 16 + Supabase stack. Part A changes the booking lifecycle: a new `pending_verification` status joins the `no_overlap` GiST exclusion constraint so unverified-but-paid bookings hold their room, and a `booking.settings` key/value table makes payment details editable without a deploy. Parts B–D are additive: a new `feedback` table reached only through a `SECURITY DEFINER` function, a `room_type_photos` table reusing the existing public bucket, and a keyless Google Maps iframe.

**Tech Stack:** Next 16 (App Router, `src/proxy.ts`, async `cookies()`/`params`/`searchParams`), React 19, Supabase (Postgres + Storage, custom `booking` schema), shadcn `base-nova` (Base UI), react-hook-form + Zod 4, Tailwind 4. New dependency: `qrcode`.

## Global Constraints

- **Custom schema `booking`** — every DB object lives there, never `public`. Supabase clients are pre-bound via `{ db: { schema: "booking" } }`.
- **SHARED Supabase project** — NEVER create triggers on `auth.users`, NEVER register project-wide auth hooks. All storage policies MUST be scoped by `bucket_id` so they cannot touch other projects' objects.
- **Migrations are applied to the hosted DB manually by the user** — keep every migration idempotent-friendly (`if not exists`, `drop policy if exists` then create, `do $$ ... exception when duplicate_object then null; end $$`).
- **shadcn style is `base-nova` (Base UI, not Radix)** — composition uses the `render` prop. **There is no `asChild`.**
- **Mutations only via server actions**: `"use server"` → `requireRole()` guard → Zod parse → repository/supabase → `logAudit()` → `revalidatePath()` → return `ActionResult<T>`.
- **Reads via `features/<module>/repository.ts`** using the RLS-scoped server client. The admin client (`lib/supabase/admin.ts`) is used ONLY where RLS cannot express the rule: portal availability, portal booking insert, audit writes, and (new) portal settings reads, proof upload, and feedback submit.
- **Node ≥ 22.** Run `nvm use 22` first. Supabase CLI is a devDependency — use `npm run db:*`.
- **Local ports are the `546xx` range** (API 54621, DB 54622, Studio 54623).
- **After every migration:** `npm run db:types`. Before closing: `npm run lint && npm run build`.
- **Canonical site URL is `https://bti.kerisoftware.com`** — deliberately hardcoded, not read from env.
- **Deposit default is 50%**, stored as `deposit_percent` in `booking.settings`.
- Currency is PHP, formatted with the existing `peso` formatter from `features/bookings/pricing.ts`.

---

## File Structure

**Part A — Settings, deposit, verification**

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260726000100_settings.sql` | `booking.settings` table, seed, RLS |
| `supabase/migrations/20260726000200_add_pending_status.sql` | **only** the enum value |
| `supabase/migrations/20260726000300_booking_verification.sql` | exclusion constraint, `booking_proofs`, private bucket, function updates |
| `src/features/settings/schemas.ts` | Zod schema + `SETTING_KEYS` |
| `src/features/settings/repository.ts` | `getSettings`, `getPublicSettings` |
| `src/features/settings/actions.ts` | `saveSettings` |
| `src/app/(app)/settings/page.tsx` | admin settings page |
| `src/features/settings/components/settings-form.tsx` | the form |
| `src/features/bookings/deposit.ts` | pure `depositFor` |
| `src/features/portal/proof-schema.ts` | proof Zod schema |
| `src/features/portal/actions.ts` | extend with proof upload + pending status |
| `src/features/portal/components/portal-booking-form.tsx` | payment step |
| `src/features/bookings/verification-actions.ts` | `confirmBooking`, `rejectBooking`, `loadProof` |
| `src/features/bookings/components/verification-panel.tsx` | proof review UI |

**Part B — Feedback** · `supabase/migrations/20260726000400_feedback.sql`, `src/lib/site.ts`, `src/features/feedback/{schemas,repository,actions}.ts`, `src/app/(portal)/feedback/[roomId]/page.tsx`, `src/features/feedback/components/feedback-form.tsx`, `src/app/(app)/rooms/qr/page.tsx`, `src/app/(app)/feedbacks/page.tsx`, `src/features/feedback/components/feedbacks-table.tsx`

**Part C — Photos** · `supabase/migrations/20260726000500_room_type_photos_multi.sql`, `src/features/rooms/components/{photos-field,tier-row}.tsx`, `src/features/portal/components/room-gallery.tsx`

**Part D — Map** · `src/features/portal/components/find-us.tsx`

---

## Task Order & Independence

Parts run A → B → C → D. **Part A is strictly ordered internally** (A1→A9). Parts B, C, D are independent of each other and of A after A1 (they only need `booking.settings` for the map). Each part ends in a working, shippable state.

---

# PART A — Settings, deposit & verification

### Task A1: `booking.settings` table and admin settings page

**Files:**
- Create: `supabase/migrations/20260726000100_settings.sql`
- Create: `src/features/settings/schemas.ts`
- Create: `src/features/settings/repository.ts`
- Create: `src/features/settings/actions.ts`
- Create: `src/features/settings/components/settings-form.tsx`
- Create: `src/app/(app)/settings/page.tsx`
- Modify: `src/components/layout/app-sidebar.tsx`

**Interfaces:**
- Produces: `SETTING_KEYS` (readonly string tuple), `type SettingKey`, `settingsSchema` (Zod object keyed by every setting key, all `string`), `getSettings(): Promise<Record<SettingKey, string>>`, `getPublicSettings(): Promise<Record<SettingKey, string>>` (admin-client, used by the portal), `saveSettings(input: unknown): Promise<ActionResult<{ count: number }>>`.
- Consumes: nothing.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260726000100_settings.sql`:

```sql
-- ============================================================
-- Travelers Inn · Migration 11: booking.settings
--
-- Key/value configuration the admin can edit without a deploy: GCash and bank
-- details shown to portal guests, the deposit percentage, and the inn's
-- address/coordinates for the map. Nothing secret is ever stored here — the
-- `is_public` rows are readable by anyone.
-- ============================================================

create table if not exists booking.settings (
  key text primary key,
  value text not null default '',
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

do $$ begin
  create trigger set_updated_at before update on booking.settings
    for each row execute function booking.set_updated_at();
exception when duplicate_object then null; end $$;

-- Seed. Address/coords carry a sentinel so the UI can hide the map until it is
-- configured; ON CONFLICT DO NOTHING keeps re-runs from clobbering real values.
insert into booking.settings (key, value, is_public) values
  ('gcash_name',          '',              true),
  ('gcash_number',        '',              true),
  ('bank_name',           '',              true),
  ('bank_account_name',   '',              true),
  ('bank_account_number', '',              true),
  ('deposit_percent',     '50',            true),
  ('inn_address',         'TODO_REPLACE',  true),
  ('inn_map_lat',         'TODO_REPLACE',  true),
  ('inn_map_lng',         'TODO_REPLACE',  true)
on conflict (key) do nothing;

alter table booking.settings enable row level security;

do $$ begin
  create policy settings_public_read on booking.settings for select using (is_public);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy settings_staff_read on booking.settings for select
    using (booking.fn_is_active_user());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy settings_admin_write on booking.settings for all
    using (booking.fn_is_admin())
    with check (booking.fn_is_admin());
exception when duplicate_object then null; end $$;
```

- [ ] **Step 2: Apply and regenerate types**

```bash
npm run db:reset && npm run db:types
```

Expected: reset succeeds, `src/types/database.types.ts` now contains a `settings` entry under `booking.Tables`.

- [ ] **Step 3: Write the schema module**

Create `src/features/settings/schemas.ts`:

```ts
import { z } from "zod";

// Every configurable key. Adding one here + a row in the migration is all it
// takes for it to appear in the admin form.
export const SETTING_KEYS = [
  "gcash_name",
  "gcash_number",
  "bank_name",
  "bank_account_name",
  "bank_account_number",
  "deposit_percent",
  "inn_address",
  "inn_map_lat",
  "inn_map_lng",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

// Sentinel seeded for values the operator must supply after deploy. The map
// section stays hidden while any of its values still holds this.
export const UNSET = "TODO_REPLACE";

export function isSet(value: string | undefined | null): boolean {
  return Boolean(value) && value !== UNSET;
}

export const settingsSchema = z.object({
  gcash_name: z.string().trim().max(120),
  gcash_number: z.string().trim().max(40),
  bank_name: z.string().trim().max(120),
  bank_account_name: z.string().trim().max(120),
  bank_account_number: z.string().trim().max(60),
  deposit_percent: z.coerce.number().min(0, "Must be ≥ 0").max(100, "Must be ≤ 100"),
  inn_address: z.string().trim().max(300),
  inn_map_lat: z.string().trim().max(40),
  inn_map_lng: z.string().trim().max(40),
});
export type SettingsFormValues = z.input<typeof settingsSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;

export const SETTING_LABELS: Record<SettingKey, string> = {
  gcash_name: "GCash account name",
  gcash_number: "GCash number",
  bank_name: "Bank name",
  bank_account_name: "Bank account name",
  bank_account_number: "Bank account number",
  deposit_percent: "Deposit percent",
  inn_address: "Inn address",
  inn_map_lat: "Map latitude",
  inn_map_lng: "Map longitude",
};
```

- [ ] **Step 4: Write the repository**

Create `src/features/settings/repository.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SETTING_KEYS, type SettingKey } from "./schemas";

export type SettingsMap = Record<SettingKey, string>;

function toMap(rows: { key: string; value: string }[] | null): SettingsMap {
  const map = Object.fromEntries(SETTING_KEYS.map((k) => [k, ""])) as SettingsMap;
  for (const row of rows ?? []) {
    if ((SETTING_KEYS as readonly string[]).includes(row.key)) {
      map[row.key as SettingKey] = row.value;
    }
  }
  return map;
}

// Staff-side read under RLS.
export async function getSettings(): Promise<SettingsMap> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key, value");
  return toMap(data);
}

// Portal-side read. The portal is anonymous and already reads through the admin
// client (see features/portal/repository.ts); this keeps that one pattern.
export async function getPublicSettings(): Promise<SettingsMap> {
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("key, value").eq("is_public", true);
  return toMap(data);
}
```

- [ ] **Step 5: Write the action**

Create `src/features/settings/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { settingsSchema } from "./schemas";

export async function saveSettings(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireRole(["admin"]);
    const parsed = settingsSchema.parse(input);
    const supabase = await createClient();

    const rows = Object.entries(parsed).map(([key, value]) => ({
      key,
      value: String(value),
      is_public: true,
    }));
    const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
    if (error) return fail(error.message);

    await logAudit({
      actorId: user.id,
      action: "settings.update",
      entity: "settings",
      diff: { keys: rows.map((r) => r.key) },
    });
    revalidatePath("/settings");
    revalidatePath("/");
    return ok({ count: rows.length });
  } catch (err) {
    return toActionError(err);
  }
}
```

- [ ] **Step 6: Write the form component**

Create `src/features/settings/components/settings-form.tsx`:

```tsx
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
```

- [ ] **Step 7: Write the page**

Create `src/app/(app)/settings/page.tsx`:

```tsx
import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";
import { getSettings } from "@/features/settings/repository";
import { SettingsForm } from "@/features/settings/components/settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireRole(["admin"]);
  const settings = await getSettings();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Payment details shown to guests, the deposit rate, and the inn's map location."
      />
      <SettingsForm settings={settings} />
    </div>
  );
}
```

- [ ] **Step 8: Add the sidebar link**

In `src/components/layout/app-sidebar.tsx`, add `Settings` to the lucide import list and append to `NAV`:

```ts
  { title: "Settings", href: "/settings", icon: Settings, adminOnly: true },
```

- [ ] **Step 9: Verify build and route**

```bash
npm run lint && npm run build
```

Expected: both pass. Then `npm run dev`, sign in as admin, visit `/settings`, save a GCash number, reload — the value persists.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260726000100_settings.sql src/features/settings src/app/\(app\)/settings src/components/layout/app-sidebar.tsx src/types/database.types.ts
git commit -m "feat(settings): admin-editable payment, deposit and location settings"
```

---

### Task A2: Add the `pending_verification` enum value

**Files:**
- Create: `supabase/migrations/20260726000200_add_pending_status.sql`

**Interfaces:**
- Produces: the enum label `'pending_verification'` on `booking.booking_status`.
- Consumes: nothing.

> **Why this is its own file:** Postgres refuses to *use* an enum value in the same transaction that added it ("unsafe use of new value of enum type"), and each migration file runs in one transaction. Task A3's exclusion constraint names this value in its `WHERE` clause, so combining them would fail on a clean `npm run db:reset`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260726000200_add_pending_status.sql`:

```sql
-- ============================================================
-- Travelers Inn · Migration 12: pending_verification booking status
--
-- MUST stay alone in this file. Postgres cannot use a newly added enum value in
-- the same transaction that added it, and every migration file runs in one
-- transaction — migration 13 references 'pending_verification' in the
-- no_overlap constraint's WHERE clause.
-- ============================================================

alter type booking.booking_status add value if not exists 'pending_verification';
```

- [ ] **Step 2: Apply and verify the value exists**

```bash
npm run db:reset
npx supabase db execute --local "select unnest(enum_range(null::booking.booking_status))"
```

Expected: output lists `pending_verification` alongside the five existing statuses.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260726000200_add_pending_status.sql
git commit -m "feat(db): add pending_verification booking status"
```

---

### Task A3: Verification schema — constraint, proofs table, private bucket, function updates

**Files:**
- Create: `supabase/migrations/20260726000300_booking_verification.sql`
- Modify: `src/types/database.types.ts` (generated)

**Interfaces:**
- Consumes: `'pending_verification'` from Task A2.
- Produces: table `booking.booking_proofs`; storage bucket `travelers-inn-payment-proofs`; `booking.fn_create_booking(text, text, text, uuid, uuid, int, timestamptz, timestamptz, booking.booking_source, text, booking.booking_status)` — note the **new trailing `p_status` parameter defaulting to `'confirmed'`**; updated `fn_count_available` and `fn_available_rooms` bodies.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260726000300_booking_verification.sql`:

```sql
-- ============================================================
-- Travelers Inn · Migration 13: deposit verification
--
-- A portal guest now pays a deposit up front and uploads proof. The booking is
-- created as 'pending_verification' and HOLDS ITS ROOM: the status joins the
-- no_overlap exclusion constraint, so a guest who has paid can never lose the
-- room to a later booker. Every availability function is widened to match, or
-- counts would over-report free rooms.
--
-- Proofs are financial documents (names, reference numbers), so unlike the room
-- photo bucket this one is PRIVATE — staff read via short-lived signed URLs.
-- Every storage policy is scoped by bucket_id, so these rules cannot touch
-- other projects' objects in this shared Supabase instance.
-- ============================================================

-- ---- the double-booking guarantee, widened ---------------------------------
alter table booking.bookings drop constraint if exists no_overlap;
alter table booking.bookings
  add constraint no_overlap
  exclude using gist (room_id with =, period with &&)
  where (status in ('pending_verification', 'confirmed', 'checked_in'));

-- ---- proofs -----------------------------------------------------------------
create table if not exists booking.booking_proofs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references booking.bookings (id) on delete cascade,
  method booking.payment_method not null,
  reference_no text,
  declared_amount numeric(10, 2) not null check (declared_amount > 0),
  storage_path text not null,
  created_at timestamptz not null default now(),
  constraint booking_proofs_method_allowed check (method in ('gcash', 'bank_transfer'))
);
create index if not exists booking_proofs_booking_id_idx
  on booking.booking_proofs (booking_id);

alter table booking.booking_proofs enable row level security;

-- Staff only. The portal writes through the admin client inside a server
-- action, exactly as it already does for fn_create_booking.
do $$ begin
  create policy booking_proofs_staff_read on booking.booking_proofs for select
    using (booking.fn_is_active_user());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy booking_proofs_staff_write on booking.booking_proofs for all
    using (booking.fn_is_active_user())
    with check (booking.fn_is_active_user());
exception when duplicate_object then null; end $$;

-- ---- private proof bucket ---------------------------------------------------
insert into storage.buckets (id, name, public)
values ('travelers-inn-payment-proofs', 'travelers-inn-payment-proofs', false)
on conflict (id) do nothing;

drop policy if exists ti_proofs_staff_read on storage.objects;
drop policy if exists ti_proofs_staff_insert on storage.objects;
drop policy if exists ti_proofs_admin_delete on storage.objects;

-- NO anon select policy: proofs are never world-readable.
create policy ti_proofs_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'travelers-inn-payment-proofs' and booking.fn_is_active_user());
create policy ti_proofs_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'travelers-inn-payment-proofs' and booking.fn_is_active_user());
create policy ti_proofs_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'travelers-inn-payment-proofs' and booking.fn_is_admin());

-- ---- availability functions, widened ---------------------------------------
create or replace function booking.fn_count_available(
  p_room_type_id uuid, p_check_in timestamptz, p_check_out timestamptz
) returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from booking.rooms r
  where r.room_type_id = p_room_type_id
    and r.status <> 'out_of_service'
    and not exists (
      select 1 from booking.bookings b
      where b.room_id = r.id
        and b.status in ('pending_verification', 'confirmed', 'checked_in')
        and b.period && tstzrange(p_check_in, p_check_out, '[)')
    );
$$;

create or replace function booking.fn_available_rooms(
  p_room_type_id uuid,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_exclude_booking uuid default null
) returns setof booking.rooms language sql stable security definer set search_path = '' as $$
  select r.* from booking.rooms r
  where r.room_type_id = p_room_type_id
    and r.status <> 'out_of_service'
    and not exists (
      select 1 from booking.bookings b
      where b.room_id = r.id
        and b.status in ('pending_verification', 'confirmed', 'checked_in')
        and (p_exclude_booking is null or b.id <> p_exclude_booking)
        and b.period && tstzrange(p_check_in, p_check_out, '[)')
    )
  order by r.label;
$$;

-- ---- fn_create_booking: optional initial status -----------------------------
-- Adding a parameter changes the signature, so the old overload is dropped
-- first; leaving both would make every call ambiguous.
drop function if exists booking.fn_create_booking(
  text, text, text, uuid, uuid, int, timestamptz, timestamptz,
  booking.booking_source, text
);

create or replace function booking.fn_create_booking(
  p_guest_name text,
  p_guest_phone text,
  p_guest_email text,
  p_room_type_id uuid,
  p_rate_tier_id uuid,
  p_guest_count int,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_source booking.booking_source,
  p_notes text default null,
  p_status booking.booking_status default 'confirmed'
) returns booking.bookings language plpgsql security definer set search_path = '' as $$
declare
  v_type booking.room_types;
  v_tier booking.rate_tiers;
  v_check_out timestamptz;
  v_period tstzrange;
  v_nights int;
  v_excess_heads int;
  v_excess_per_unit numeric(10,2);
  v_total numeric(10,2);
  v_room record;
  v_booking booking.bookings;
begin
  if p_status not in ('confirmed', 'pending_verification') then
    raise exception 'A new booking must start confirmed or pending verification.';
  end if;

  select * into v_type from booking.room_types where id = p_room_type_id and is_active;
  if v_type.id is null then
    raise exception 'That room type is not bookable.';
  end if;

  select * into v_tier from booking.rate_tiers
    where id = p_rate_tier_id and room_type_id = p_room_type_id and is_active;
  if v_tier.id is null then
    raise exception 'That rate is not available for this room type.';
  end if;

  if p_guest_count < 1 then
    raise exception 'At least one guest is required.';
  end if;
  if p_guest_count > v_type.max_occupancy then
    raise exception 'This room accommodates at most % guests.', v_type.max_occupancy;
  end if;

  v_excess_heads := greatest(0, p_guest_count - v_type.base_occupancy);
  v_excess_per_unit := v_excess_heads * v_type.excess_person_rate;

  if v_tier.kind = 'block' then
    v_check_out := p_check_in + make_interval(hours => v_tier.duration_hours);
    v_total := v_tier.price + v_excess_per_unit;
  else
    if p_check_out <= p_check_in then
      raise exception 'Check-out must be after check-in.';
    end if;
    v_nights := greatest(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 86400.0)::int);
    v_check_out := p_check_out;
    v_total := (v_tier.price + v_excess_per_unit) * v_nights;
  end if;

  v_period := tstzrange(p_check_in, v_check_out, '[)');

  for v_room in
    select r.id from booking.rooms r
    where r.room_type_id = p_room_type_id
      and r.status <> 'out_of_service'
      and not exists (
        select 1 from booking.bookings b
        where b.room_id = r.id
          and b.status in ('pending_verification', 'confirmed', 'checked_in')
          and b.period && v_period
      )
    order by r.label
  loop
    begin
      insert into booking.bookings
        (guest_name, guest_phone, guest_email, room_type_id, room_id, rate_tier_id,
         guest_count, period, source, status, quoted_total, notes, created_by)
      values
        (p_guest_name, nullif(p_guest_phone, ''), nullif(p_guest_email, ''),
         p_room_type_id, v_room.id, p_rate_tier_id, p_guest_count, v_period, p_source,
         p_status, v_total, nullif(p_notes, ''), (select auth.uid()))
      returning * into v_booking;
      return v_booking;
    exception when exclusion_violation then
      -- Lost the race for this room; try the next free one.
      continue;
    end;
  end loop;

  raise exception 'No rooms of that type are free for those dates.';
end;
$$;

grant execute on function booking.fn_create_booking(
  text, text, text, uuid, uuid, int, timestamptz, timestamptz,
  booking.booking_source, text, booking.booking_status
) to authenticated;
```

- [ ] **Step 2: Apply and regenerate types**

```bash
npm run db:reset && npm run db:types
```

Expected: reset succeeds. `booking_proofs` appears in `database.types.ts`.

- [ ] **Step 3: Verify existing suites still pass**

```bash
npm run test:db
```

Expected: all 40 existing tests pass. `bookings.test.mjs` and `front-desk.test.mjs` are the regression guard for the constraint change — if either fails, the constraint or a function body is wrong.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260726000300_booking_verification.sql src/types/database.types.ts
git commit -m "feat(db): deposit proofs, private bucket, pending bookings hold rooms"
```

---

### Task A4: Verification DB tests

**Files:**
- Create: `supabase/tests/verification.test.mjs`
- Modify: `package.json` (the `test:db` script)

**Interfaces:**
- Consumes: `fn_create_booking` with `p_status` (Task A3), `fn_count_available` (Task A3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/verification.test.mjs`:

```js
// Integration tests for the deposit-verification lifecycle against the real
// local stack. The load-bearing assertion is that a pending_verification
// booking HOLDS its room — a guest who has paid must never lose it.
//
// Run: npm run db:start && node supabase/tests/verification.test.mjs
import assert from "node:assert/strict";
import { adminBooking, resetIdentity } from "./_helpers.mjs";

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const W = ["2026-10-10T14:00:00Z", "2026-10-12T12:00:00Z"]; // 2 nights

function one(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  console.log("deposit verification");
  await resetIdentity();
  const b = adminBooking();
  await b.from("bookings").delete().not("id", "is", null);
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);

  // One room only, so a held room is provably unavailable to the next booker.
  const { data: type } = await b
    .from("room_types")
    .insert({ name: "Verify Solo", base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 })
    .select("id")
    .single();
  await b.from("rooms").insert({ room_type_id: type.id, label: "V1" });
  const { data: tier } = await b
    .from("rate_tiers")
    .insert({ room_type_id: type.id, label: "Overnight", kind: "overnight", price: 1000 })
    .select("id")
    .single();

  const makeBooking = (status, name) =>
    b.rpc("fn_create_booking", {
      p_guest_name: name,
      p_guest_phone: "09170000000",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: W[0],
      p_check_out: W[1],
      p_source: "portal",
      p_notes: "",
      p_status: status,
    });

  let pendingId = null;

  await test("a portal booking can be created as pending_verification", async () => {
    const { data, error } = await makeBooking("pending_verification", "Pending Guest");
    assert.equal(error, null);
    const row = one(data);
    assert.equal(row.status, "pending_verification");
    assert.equal(row.source, "portal");
    assert.equal(Number(row.quoted_total), 2000); // 1000 × 2 nights
    pendingId = row.id;
  });

  await test("a pending booking HOLDS the room against an overlapping booking", async () => {
    const { data, error } = await makeBooking("confirmed", "Late Guest");
    assert.equal(data, null);
    assert.match(error.message, /No rooms of that type are free/);
  });

  await test("fn_count_available excludes a room held by a pending booking", async () => {
    const { data } = await b.rpc("fn_count_available", {
      p_room_type_id: type.id,
      p_check_in: W[0],
      p_check_out: W[1],
    });
    assert.equal(data, 0);
  });

  await test("confirming records a payment and derives partial payment status", async () => {
    await b.from("bookings").update({ status: "confirmed" }).eq("id", pendingId);
    await b.from("payments").insert({ booking_id: pendingId, amount: 1000, method: "gcash" });
    const { data } = await b
      .from("bookings")
      .select("status, payment_status")
      .eq("id", pendingId)
      .single();
    assert.equal(data.status, "confirmed");
    assert.equal(data.payment_status, "partial"); // 1000 of 2000
  });

  await test("rejecting a pending booking frees the room", async () => {
    // Fresh pending booking on a non-overlapping window, then cancel it.
    const W2 = ["2026-11-01T14:00:00Z", "2026-11-02T12:00:00Z"];
    const { data: created } = await b.rpc("fn_create_booking", {
      p_guest_name: "Reject Me",
      p_guest_phone: "09170000001",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: W2[0],
      p_check_out: W2[1],
      p_source: "portal",
      p_notes: "",
      p_status: "pending_verification",
    });
    const rejectId = one(created).id;

    await b.from("bookings").update({ status: "cancelled" }).eq("id", rejectId);

    const { data: count } = await b.rpc("fn_count_available", {
      p_room_type_id: type.id,
      p_check_in: W2[0],
      p_check_out: W2[1],
    });
    assert.equal(count, 1, "the room should be bookable again after rejection");
  });

  await test("p_status defaults to confirmed so walk-ins are unaffected", async () => {
    const W3 = ["2026-12-01T14:00:00Z", "2026-12-02T12:00:00Z"];
    const { data, error } = await b.rpc("fn_create_booking", {
      p_guest_name: "Walk In",
      p_guest_phone: "09170000002",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: W3[0],
      p_check_out: W3[1],
      p_source: "walk_in",
      p_notes: "",
      // p_status deliberately omitted
    });
    assert.equal(error, null);
    assert.equal(one(data).status, "confirmed");
  });

  await test("a proof row attaches to a booking and cascades on delete", async () => {
    const { error } = await b.from("booking_proofs").insert({
      booking_id: pendingId,
      method: "gcash",
      reference_no: "ABC123",
      declared_amount: 1000,
      storage_path: "test/proof.jpg",
    });
    assert.equal(error, null);

    await b.from("bookings").delete().eq("id", pendingId);
    const { data: orphans } = await b
      .from("booking_proofs")
      .select("id")
      .eq("booking_id", pendingId);
    assert.equal(orphans.length, 0);
  });

  console.log(`\n${passed} passed`);
}

main();
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
node supabase/tests/verification.test.mjs
```

Expected: **FAIL** if Task A3 was not applied — errors mentioning an unknown `p_status` parameter. If Task A3 is already applied it should PASS; in that case re-read Task A3's migration to confirm every function body was updated.

- [ ] **Step 3: Reset the DB and run again**

```bash
npm run db:reset && node supabase/tests/verification.test.mjs
```

Expected: `7 passed`.

- [ ] **Step 4: Register the suite**

In `package.json`, append to the `test:db` script (before the `.ts` tests):

```
&& node supabase/tests/verification.test.mjs
```

- [ ] **Step 5: Run the whole suite**

```bash
npm run test:db
```

Expected: 47 passing (40 existing + 7 new).

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/verification.test.mjs package.json
git commit -m "test(db): verification lifecycle and pending-holds-room guarantee"
```

---

### Task A5: `depositFor` pure function

**Files:**
- Create: `src/features/bookings/deposit.ts`
- Create: `supabase/tests/deposit.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `depositFor(total: number, percent: number): number` — rounds to 2 decimals, never negative, never above `total`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/deposit.test.ts`:

```ts
// Pure unit test for the deposit calculation. Run with:
//   node --experimental-strip-types supabase/tests/deposit.test.ts
import assert from "node:assert/strict";
import { depositFor } from "../../src/features/bookings/deposit.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("depositFor()");

test("halves a round total", () => {
  assert.equal(depositFor(2000, 50), 1000);
});

test("rounds to two decimals", () => {
  assert.equal(depositFor(1250, 50), 625);
  assert.equal(depositFor(999.99, 50), 500);
});

test("handles a non-50 percentage", () => {
  assert.equal(depositFor(1000, 30), 300);
});

test("a zero total yields zero", () => {
  assert.equal(depositFor(0, 50), 0);
});

test("100 percent is the whole total", () => {
  assert.equal(depositFor(1500, 100), 1500);
});

test("clamps out-of-range percentages", () => {
  assert.equal(depositFor(1000, -10), 0);
  assert.equal(depositFor(1000, 150), 1000);
});

test("a negative total yields zero", () => {
  assert.equal(depositFor(-500, 50), 0);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --experimental-strip-types supabase/tests/deposit.test.ts
```

Expected: FAIL — cannot resolve `../../src/features/bookings/deposit.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/features/bookings/deposit.ts`:

```ts
// The up-front portion a portal guest pays. Kept pure and separately tested
// because it decides how much money changes hands — the server recomputes it
// from the authoritative quoted_total rather than trusting the client.
export function depositFor(total: number, percent: number): number {
  if (!(total > 0)) return 0;
  const pct = Math.min(100, Math.max(0, percent));
  return Math.round(total * pct) / 100;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --experimental-strip-types supabase/tests/deposit.test.ts
```

Expected: `7 passed`.

- [ ] **Step 5: Register the suite**

In `package.json`, append to `test:db`:

```
&& node --experimental-strip-types supabase/tests/deposit.test.ts
```

Then run the whole suite:

```bash
npm run test:db
```

Expected: 54 passing (47 + 7).

- [ ] **Step 6: Commit**

```bash
git add src/features/bookings/deposit.ts supabase/tests/deposit.test.ts package.json
git commit -m "feat(bookings): depositFor pure calculation with unit tests"
```

---

### Task A6: Portal booking action with proof upload

**Files:**
- Modify: `src/features/portal/schemas.ts`
- Modify: `src/features/portal/actions.ts`
- Modify: `src/features/portal/repository.ts`

**Interfaces:**
- Consumes: `depositFor` (A5), `getPublicSettings` (A1), `fn_create_booking` with `p_status` (A3).
- Produces: `createPortalBookingWithProof(formData: FormData): Promise<ActionResult<{ reference_code: string; deposit: number }>>`; `PROOF_BUCKET` constant; `getPortalPaymentInfo(): Promise<{ gcash_name, gcash_number, bank_name, bank_account_name, bank_account_number, deposit_percent }>`.

- [ ] **Step 1: Extend the portal schema**

In `src/features/portal/schemas.ts`, append:

```ts
// The payment step. The file itself is validated in the action (FormData), not
// here — Zod runs on the server where File is available but awkward to type.
export const portalProofSchema = z.object({
  method: z.enum(["gcash", "bank_transfer"]),
  reference_no: z.string().trim().min(3, "Enter the reference number").max(80),
});

// Booking + proof, as sent by the portal form.
export const portalBookingWithProofSchema = portalBookingSchema.extend({
  method: portalProofSchema.shape.method,
  reference_no: portalProofSchema.shape.reference_no,
});
export type PortalBookingWithProofInput = z.infer<typeof portalBookingWithProofSchema>;
```

- [ ] **Step 2: Add the payment-info reader**

In `src/features/portal/repository.ts`, append:

```ts
import { getPublicSettings } from "@/features/settings/repository";

export type PortalPaymentInfo = {
  gcash_name: string;
  gcash_number: string;
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  deposit_percent: number;
};

// Payment details shown on the booking page. Falls back to 50% if the setting
// is blank or unparseable so the deposit step never renders a NaN.
export async function getPortalPaymentInfo(): Promise<PortalPaymentInfo> {
  const s = await getPublicSettings();
  const pct = Number(s.deposit_percent);
  return {
    gcash_name: s.gcash_name,
    gcash_number: s.gcash_number,
    bank_name: s.bank_name,
    bank_account_name: s.bank_account_name,
    bank_account_number: s.bank_account_number,
    deposit_percent: Number.isFinite(pct) && pct > 0 ? pct : 50,
  };
}
```

- [ ] **Step 3: Replace the portal booking action**

In `src/features/portal/actions.ts`, replace the whole file with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { portalBookingWithProofSchema } from "./schemas";
import { getPortalPaymentInfo } from "./repository";
import { depositFor } from "@/features/bookings/deposit";

const MAX_NIGHTS = 30;
export const PROOF_BUCKET = "travelers-inn-payment-proofs";
const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_PROOF_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

// Public (no-login) portal booking with a deposit proof. Runs entirely
// server-side through the admin client so fn_create_booking stays off the anon
// grant. The booking is created as 'pending_verification' — it HOLDS the room
// but is not confirmed until staff inspect the proof.
export async function createPortalBookingWithProof(
  formData: FormData
): Promise<ActionResult<{ reference_code: string; deposit: number }>> {
  try {
    const file = formData.get("proof");
    if (!(file instanceof File) || file.size === 0) {
      return fail("Please attach a screenshot or PDF of your payment.");
    }
    if (file.size > MAX_PROOF_BYTES) return fail("The file must be 5 MB or smaller.");
    const ext = ALLOWED_PROOF_TYPES[file.type];
    if (!ext) return fail("Attach a JPEG, PNG, WebP, or PDF.");

    const parsed = portalBookingWithProofSchema.parse({
      guest_name: formData.get("guest_name"),
      guest_phone: formData.get("guest_phone"),
      guest_email: formData.get("guest_email") ?? "",
      room_type_id: formData.get("room_type_id"),
      rate_tier_id: formData.get("rate_tier_id"),
      guest_count: formData.get("guest_count"),
      check_in: formData.get("check_in"),
      check_out: formData.get("check_out") ?? "",
      method: formData.get("method"),
      reference_no: formData.get("reference_no"),
    });

    const checkIn = new Date(parsed.check_in);
    if (Number.isNaN(checkIn.getTime())) return fail("Please choose a valid date.");

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (checkIn < startOfToday) return fail("Please choose a future date.");

    // Overnight stays send a check-out; blocks derive it server-side.
    let checkOutISO = checkIn.toISOString();
    if (parsed.check_out) {
      const checkOut = new Date(parsed.check_out);
      if (Number.isNaN(checkOut.getTime())) return fail("Please choose a valid check-out date.");
      if (checkOut <= checkIn) return fail("Check-out must be after check-in.");
      if (checkOut.getTime() - checkIn.getTime() > MAX_NIGHTS * 86_400_000) {
        return fail("For stays longer than a month, please contact us directly.");
      }
      checkOutISO = checkOut.toISOString();
    }

    const admin = createAdminClient();

    // Upload FIRST: a storage failure must never leave a booking without proof.
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from(PROOF_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return fail("We couldn't upload your proof of payment. Please try again.");

    const { data, error } = await admin.rpc("fn_create_booking", {
      p_guest_name: parsed.guest_name,
      p_guest_phone: parsed.guest_phone,
      p_guest_email: parsed.guest_email || "",
      p_room_type_id: parsed.room_type_id,
      p_rate_tier_id: parsed.rate_tier_id,
      p_guest_count: parsed.guest_count,
      p_check_in: checkIn.toISOString(),
      p_check_out: checkOutISO,
      p_source: "portal",
      p_notes: "",
      p_status: "pending_verification",
    });
    if (error) {
      await admin.storage.from(PROOF_BUCKET).remove([path]); // don't orphan the object
      return fail(error.message);
    }

    const row = (Array.isArray(data) ? data[0] : data) as {
      id: string;
      reference_code: string;
      quoted_total: string | number;
    } | null;
    if (!row) {
      await admin.storage.from(PROOF_BUCKET).remove([path]);
      return fail("We couldn't complete your booking. Please try again.");
    }

    // Recomputed server-side from the authoritative total — never trusted from
    // the client, which only ever displayed this number.
    const { deposit_percent } = await getPortalPaymentInfo();
    const deposit = depositFor(Number(row.quoted_total), deposit_percent);

    await admin.from("booking_proofs").insert({
      booking_id: row.id,
      method: parsed.method,
      reference_no: parsed.reference_no,
      declared_amount: deposit,
      storage_path: path,
    });

    await logAudit({
      action: "booking.portal_create_pending",
      entity: "booking",
      entityId: row.id,
      diff: { source: "portal", room_type_id: parsed.room_type_id, deposit },
    });
    revalidatePath("/");
    revalidatePath("/bookings");
    revalidatePath("/calendar");
    return ok({ reference_code: row.reference_code, deposit });
  } catch (err) {
    return toActionError(err);
  }
}
```

- [ ] **Step 4: Verify it compiles**

```bash
npm run lint && npm run build
```

Expected: build fails **only** in `portal-booking-form.tsx`, which still imports the removed `createPortalBooking`. That is fixed in Task A7.

- [ ] **Step 5: Commit after A7**

This task and A7 land together — the build is red between them. Do not commit yet.

---

### Task A7: Portal booking form payment step

**Files:**
- Modify: `src/features/portal/components/portal-booking-form.tsx`
- Modify: `src/app/(portal)/book/page.tsx`

**Interfaces:**
- Consumes: `createPortalBookingWithProof` (A6), `getPortalPaymentInfo` + `PortalPaymentInfo` (A6), `depositFor` (A5).
- Produces: `PortalBookingForm` now takes an extra `payment: PortalPaymentInfo` prop.

- [ ] **Step 1: Pass payment info from the page**

In `src/app/(portal)/book/page.tsx`:

Add to the imports:

```tsx
import { getPortalPaymentInfo } from "@/features/portal/repository";
```

After the `options` fetch, add:

```tsx
  const payment = await getPortalPaymentInfo();
```

And pass it to the form:

```tsx
          <PortalBookingForm
            option={option}
            roomTypeName={option.name}
            checkIn={sp.checkIn}
            checkOut={sp.checkOut}
            payment={payment}
          />
```

- [ ] **Step 2: Add the payment step to the form**

In `src/features/portal/components/portal-booking-form.tsx`:

Replace the import of the action:

```tsx
import { createPortalBookingWithProof } from "@/features/portal/actions";
import { depositFor } from "@/features/bookings/deposit";
import type { AvailabilityOption, PortalPaymentInfo } from "@/features/portal/repository";
```

Add `Upload`, `ShieldCheck` and `Landmark` to the lucide import. Extend the contact schema with the payment fields:

```tsx
const contactSchema = z.object({
  guest_name: z.string().trim().min(1, "Please enter your name").max(120),
  guest_phone: z.string().trim().min(7, "Please enter a contact number").max(40),
  guest_email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  method: z.enum(["gcash", "bank_transfer"]),
  reference_no: z.string().trim().min(3, "Enter the reference number").max(80),
});
```

Update the component signature and defaults:

```tsx
export function PortalBookingForm({
  option,
  roomTypeName,
  checkIn,
  checkOut,
  payment,
}: {
  option: AvailabilityOption;
  roomTypeName: string;
  checkIn: string;
  checkOut: string;
  payment: PortalPaymentInfo;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState<{ code: string; deposit: number } | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
```

and

```tsx
  const form = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      guest_name: "",
      guest_phone: "",
      guest_email: "",
      method: "gcash",
      reference_no: "",
    },
  });

  const method = form.watch("method");
```

Derive the deposit next to `priceError`:

```tsx
  const total = priceQuote && "total" in priceQuote ? priceQuote.total : 0;
  const deposit = depositFor(total, payment.deposit_percent);
```

Replace `onSubmit` with the FormData version:

```tsx
  function onSubmit(contact: ContactValues) {
    if (!tier || priceError) return;
    if (!proofFile) {
      setProofError("Please attach your proof of payment.");
      return;
    }
    setProofError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("guest_name", contact.guest_name);
      fd.set("guest_phone", contact.guest_phone);
      fd.set("guest_email", contact.guest_email ?? "");
      fd.set("room_type_id", option.id);
      fd.set("rate_tier_id", tier.id);
      fd.set("guest_count", String(guestCount));
      fd.set("check_in", checkInISO);
      fd.set("check_out", isOvernight ? checkOutISO : "");
      fd.set("method", contact.method);
      fd.set("reference_no", contact.reference_no);
      fd.set("proof", proofFile);

      const result = await createPortalBookingWithProof(fd);
      if (result.ok) {
        setConfirmed({ code: result.data.reference_code, deposit: result.data.deposit });
      } else {
        toast.error(result.error);
      }
    });
  }
```

Replace the `confirmed` branch with the "reserved, verifying" state:

```tsx
  if (confirmed) {
    return (
      <div className="border-border bg-card flex flex-col items-center gap-4 rounded-2xl border p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
          <ShieldCheck className="size-7" />
        </div>
        <div>
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold">
            Reserved — we&apos;re verifying your payment
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {roomTypeName} · {tier?.label}
          </p>
        </div>
        <div className="bg-muted/60 w-full rounded-xl p-4">
          <div className="text-muted-foreground text-xs uppercase tracking-wide">Your reference</div>
          <div className="font-[family-name:var(--font-fraunces)] text-primary text-3xl font-semibold tracking-wide">
            {confirmed.code}
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          Your room is held. We&apos;ve received your {peso.format(confirmed.deposit)} deposit and
          will confirm by text once we&apos;ve checked it — usually within a few hours. Settle the
          balance at the front desk on arrival.
        </p>
        <Button nativeButton={false} render={<Link href="/" />} variant="outline">
          Book another stay
        </Button>
      </div>
    );
  }
```

Insert the payment step between the contact `FormInput`s and the submit button:

```tsx
      {/* Deposit */}
      <div className="border-border flex flex-col gap-3 rounded-xl border p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">Pay a deposit to reserve</span>
          <span className="text-primary text-xl font-semibold">{peso.format(deposit)}</span>
        </div>
        <p className="text-muted-foreground text-xs">
          {payment.deposit_percent}% of {peso.format(total)}. The balance is paid at the front desk.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {(["gcash", "bank_transfer"] as const).map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => form.setValue("method", m)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                method === m
                  ? "border-primary ring-primary/30 bg-primary/5 ring-1"
                  : "border-border hover:border-foreground/20"
              }`}
            >
              {m === "gcash" ? "GCash" : "Bank transfer"}
            </button>
          ))}
        </div>

        <div className="bg-muted/50 rounded-lg p-3 text-sm">
          {method === "gcash" ? (
            <>
              <div className="text-muted-foreground text-xs">Send to GCash</div>
              <div className="font-medium">{payment.gcash_number || "—"}</div>
              <div className="text-muted-foreground text-xs">{payment.gcash_name}</div>
            </>
          ) : (
            <>
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Landmark className="size-3.5" /> Bank transfer
              </div>
              <div className="font-medium">{payment.bank_account_number || "—"}</div>
              <div className="text-muted-foreground text-xs">
                {payment.bank_account_name}
                {payment.bank_name ? ` · ${payment.bank_name}` : ""}
              </div>
            </>
          )}
        </div>

        <FormInput
          control={form.control}
          name="reference_no"
          label="Reference number"
          placeholder="From your GCash / bank receipt"
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Proof of payment</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="file:bg-muted file:text-foreground text-muted-foreground w-full text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-2 file:text-sm file:font-medium"
            onChange={(e) => {
              setProofFile(e.target.files?.[0] ?? null);
              setProofError(null);
            }}
          />
          <span className="text-muted-foreground text-xs">
            Screenshot or PDF · JPEG, PNG, WebP, or PDF up to 5 MB
          </span>
          {proofError ? <span className="text-destructive text-xs">{proofError}</span> : null}
        </div>
      </div>
```

Update the submit button and footnote:

```tsx
      <Button type="submit" size="lg" disabled={pending || Boolean(priceError)} className="mt-1">
        {pending ? (
          "Submitting…"
        ) : (
          <>
            <Upload className="size-4" /> Reserve &amp; submit payment
          </>
        )}
      </Button>
      <p className="text-muted-foreground text-center text-xs">
        Your room is held while we verify your deposit.
      </p>
```

- [ ] **Step 3: Verify build**

```bash
npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 4: Smoke-test the flow**

```bash
npm run dev
```

Set a GCash number at `/settings`, then from `/` search dates, pick a room, fill the form, attach any image, submit. Expected: the "Reserved — we're verifying your payment" screen with a reference code. In Supabase Studio (port 54623) confirm the booking row has `status = 'pending_verification'` and a matching `booking_proofs` row.

- [ ] **Step 5: Commit**

```bash
git add src/features/portal src/app/\(portal\)/book/page.tsx
git commit -m "feat(portal): 50% deposit with GCash/bank proof upload"
```

---

### Task A8: Surface the new status in staff UI

**Files:**
- Modify: `src/features/bookings/schemas.ts`
- Modify: `src/features/bookings/components/booking-status-badge.tsx`
- Modify: `src/features/bookings/repository.ts`
- Modify: `src/app/(app)/bookings/page.tsx`

**Interfaces:**
- Produces: `BOOKING_STATUSES` including `pending_verification`; `countPendingVerification(): Promise<number>`.
- Consumes: the enum value from A2.

- [ ] **Step 1: Add the status to the shared schema**

In `src/features/bookings/schemas.ts`, update both constants:

```ts
export const BOOKING_STATUSES = [
  "pending_verification",
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
] as const;
```

```ts
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending_verification: "For verification",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No-show",
};
```

- [ ] **Step 2: Give it a badge variant**

In `src/features/bookings/components/booking-status-badge.tsx`, add to `STATUS_VARIANT`:

```ts
  pending_verification: "secondary",
```

and make it visually distinct by giving the badge an amber tint. Replace `BookingStatusBadge` with:

```tsx
export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return (
    <Badge
      variant={STATUS_VARIANT[status]}
      className={
        status === "pending_verification"
          ? "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300"
          : undefined
      }
    >
      {BOOKING_STATUS_LABELS[status]}
    </Badge>
  );
}
```

- [ ] **Step 3: Add the count reader**

In `src/features/bookings/repository.ts`, append:

```ts
// Drives the "N awaiting verification" prompt on the bookings page.
export async function countPendingVerification(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_verification");
  return count ?? 0;
}
```

- [ ] **Step 4: Surface the queue on the bookings page**

In `src/app/(app)/bookings/page.tsx`, import `countPendingVerification` alongside the existing `listBookings` import, fetch it in the same `Promise.all` (or add an `await`), and render a callout above the table when it is non-zero:

```tsx
      {pendingCount > 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <ShieldAlert className="size-4 shrink-0 text-amber-600" />
          <span>
            <strong>{pendingCount}</strong> booking{pendingCount === 1 ? "" : "s"} awaiting payment
            verification. Open one to review the proof and confirm.
          </span>
        </div>
      ) : null}
```

Import `ShieldAlert` from `lucide-react`.

- [ ] **Step 5: Verify**

```bash
npm run lint && npm run build
```

Expected: pass. In `npm run dev`, `/bookings` shows the amber callout and the portal booking from A7 carries a "For verification" badge.

- [ ] **Step 6: Commit**

```bash
git add src/features/bookings src/app/\(app\)/bookings/page.tsx
git commit -m "feat(bookings): surface For verification status and queue count"
```

---

### Task A9: Verification panel — confirm and reject

**Files:**
- Create: `src/features/bookings/verification-actions.ts`
- Create: `src/features/bookings/components/verification-panel.tsx`
- Modify: `src/features/bookings/repository.ts`
- Modify: `src/features/bookings/components/booking-manage-dialog.tsx`

**Interfaces:**
- Consumes: `booking_proofs` (A3), `depositFor` (A5), `BookingDetail` (existing).
- Produces: `getProof(bookingId)`, `confirmBooking(bookingId, amount)`, `rejectBooking(bookingId, reason)`, `loadProofUrl(bookingId)`; `BookingDetail` gains `proof: ProofRow | null`.

- [ ] **Step 1: Extend the repository**

In `src/features/bookings/repository.ts`, add:

```ts
export type ProofRow = Database["booking"]["Tables"]["booking_proofs"]["Row"];

export async function getProof(bookingId: string): Promise<ProofRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("booking_proofs")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}
```

Add `proof: ProofRow | null` to the `BookingDetail` type, and in `getBookingWithPayments` fetch it and include it:

```ts
  const proof = booking.status === "pending_verification" ? await getProof(id) : null;
  return { booking, payments, paid: sumPaid(payments), availableRooms, proof };
```

Also widen the `availableRooms` guard so a pending booking can still be reassigned:

```ts
  const availableRooms =
    booking.status === "pending_verification" ||
    booking.status === "confirmed" ||
    booking.status === "checked_in"
      ? await listAvailableRooms(booking.room_type_id, booking.checkIn, booking.checkOut, booking.id)
      : [];
```

- [ ] **Step 2: Write the actions**

Create `src/features/bookings/verification-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { getProof } from "./repository";

const PROOF_BUCKET = "travelers-inn-payment-proofs";
const SIGNED_URL_TTL = 300; // 5 minutes — long enough to review, short enough not to leak

function revalidateBookings() {
  revalidatePath("/bookings");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

// Proofs live in a PRIVATE bucket, so the browser can't fetch the object
// directly. Mint a short-lived signed URL per view instead.
export async function loadProofUrl(bookingId: string): Promise<ActionResult<{ url: string }>> {
  try {
    await requireRole(["admin", "front_desk"]);
    const proof = await getProof(bookingId);
    if (!proof) return fail("No proof of payment on file.");

    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(PROOF_BUCKET)
      .createSignedUrl(proof.storage_path, SIGNED_URL_TTL);
    if (error || !data) return fail("Could not open the proof file.");
    return ok({ url: data.signedUrl });
  } catch (err) {
    return toActionError(err);
  }
}

// Verify the deposit: record the money, then confirm the booking. The payments
// trigger derives payment_status, so the badge can never drift from the ledger.
export async function confirmBooking(
  bookingId: string,
  amount: number
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin", "front_desk"]);
    if (!(amount > 0)) return fail("Enter the amount you verified.");
    const supabase = await createClient();

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, status")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return fail("Booking not found.");
    if (booking.status !== "pending_verification") {
      return fail("This booking is not awaiting verification.");
    }

    const proof = await getProof(bookingId);

    const { error: payError } = await supabase.from("payments").insert({
      booking_id: bookingId,
      amount,
      method: proof?.method ?? "gcash",
      reference: proof?.reference_no ?? null,
      recorded_by: user.id,
    });
    if (payError) return fail(payError.message);

    const { error } = await supabase
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", bookingId);
    if (error) return fail(error.message);

    await logAudit({
      actorId: user.id,
      action: "booking.verify_confirm",
      entity: "booking",
      entityId: bookingId,
      diff: { amount, reference: proof?.reference_no ?? null },
    });
    revalidateBookings();
    return ok({ id: bookingId });
  } catch (err) {
    return toActionError(err);
  }
}

// Reject: cancel the booking, freeing the room. Staff phone the guest on the
// number the portal requires — there is no guest-facing re-upload flow.
export async function rejectBooking(
  bookingId: string,
  reason: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireRole(["admin", "front_desk"]);
    const supabase = await createClient();

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, status, notes")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return fail("Booking not found.");
    if (booking.status !== "pending_verification") {
      return fail("This booking is not awaiting verification.");
    }

    const note = `Payment rejected: ${reason || "no reason given"}`;
    const { error } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        notes: booking.notes ? `${booking.notes}\n${note}` : note,
      })
      .eq("id", bookingId);
    if (error) return fail(error.message);

    await logAudit({
      actorId: user.id,
      action: "booking.verify_reject",
      entity: "booking",
      entityId: bookingId,
      diff: { reason },
    });
    revalidateBookings();
    return ok({ id: bookingId });
  } catch (err) {
    return toActionError(err);
  }
}
```

- [ ] **Step 3: Write the panel**

Create `src/features/bookings/components/verification-panel.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  loadProofUrl,
  confirmBooking,
  rejectBooking,
} from "@/features/bookings/verification-actions";
import { peso } from "@/features/bookings/pricing";
import { PAYMENT_METHOD_LABELS } from "@/features/bookings/payment-schema";
import type { ProofRow } from "@/features/bookings/repository";

export function VerificationPanel({
  bookingId,
  proof,
  onDone,
}: {
  bookingId: string;
  proof: ProofRow | null;
  onDone: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [amount, setAmount] = useState(proof ? String(Number(proof.declared_amount)) : "");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  // The bucket is private, so the image needs a freshly signed URL each time
  // the panel mounts.
  useEffect(() => {
    let cancelled = false;
    void loadProofUrl(bookingId).then((result) => {
      if (!cancelled && result.ok) setUrl(result.data.url);
    });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(okMsg);
        onDone();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  const isPdf = proof?.storage_path.endsWith(".pdf");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <span className="text-sm font-medium">Verify deposit</span>

      {!proof ? (
        <p className="text-muted-foreground text-sm">
          No proof of payment was attached. Contact the guest before confirming.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Method</span>
              <span className="font-medium">{PAYMENT_METHOD_LABELS[proof.method]}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Reference</span>
              <span className="font-mono text-xs font-medium">{proof.reference_no ?? "—"}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Guest says they sent</span>
              <span className="font-medium">{peso.format(Number(proof.declared_amount))}</span>
            </div>
          </div>

          {url ? (
            isPdf ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary inline-flex items-center gap-1.5 text-sm underline"
              >
                <ExternalLink className="size-3.5" /> Open the PDF receipt
              </a>
            ) : (
              <a href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="Proof of payment"
                  className="border-border max-h-72 w-full rounded-lg border object-contain"
                />
              </a>
            )
          ) : (
            <p className="text-muted-foreground text-sm">Loading proof…</p>
          )}
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">Amount actually received</span>
        <Input
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending || !(Number(amount) > 0)}
          onClick={() => run(() => confirmBooking(bookingId, Number(amount)), "Booking confirmed.")}
        >
          <Check className="size-4" /> Confirm booking
        </Button>
        <ConfirmDialog
          title="Reject this payment?"
          description="This cancels the booking and frees the room. Call the guest to let them know."
          confirmLabel="Reject & cancel"
          onConfirm={() => run(() => rejectBooking(bookingId, reason), "Booking rejected.")}
          trigger={
            <Button size="sm" variant="outline" disabled={pending}>
              <X className="size-4" /> Reject
            </Button>
          }
        />
      </div>
      <Input
        placeholder="Reason (shown in the booking notes)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </div>
  );
}
```

- [ ] **Step 4: Mount it in the manage dialog**

In `src/features/bookings/components/booking-manage-dialog.tsx`:

Add the import:

```tsx
import { VerificationPanel } from "./verification-panel";
```

Insert directly above the `{/* Lifecycle actions */}` block:

```tsx
            {status === "pending_verification" ? (
              <VerificationPanel bookingId={b.id} proof={detail.proof} onDone={refresh} />
            ) : null}
```

Widen the reassign condition so a held room can still be moved:

```tsx
              {detail.availableRooms.length > 0 &&
              (status === "pending_verification" ||
                status === "confirmed" ||
                status === "checked_in") ? (
```

- [ ] **Step 5: Verify build**

```bash
npm run lint && npm run build
```

Expected: both pass.

- [ ] **Step 6: End-to-end smoke test**

`npm run dev`. Make a portal booking with a proof image (as in A7). At `/bookings`, open it: the amber verify panel shows the uploaded image and the declared amount. Click **Confirm booking**. Expected: status becomes Confirmed, a payment appears in the ledger, `payment_status` becomes Partial. Make a second pending booking and **Reject** it: status becomes Cancelled, the note carries the reason, and the room becomes bookable again on the portal.

- [ ] **Step 7: Run all tests**

```bash
npm run test:db
```

Expected: 47 passing.

- [ ] **Step 8: Commit**

```bash
git add src/features/bookings
git commit -m "feat(bookings): staff verification panel with confirm and reject"
```

---

# PART B — Feedback QR codes

### Task B1: Feedback schema and submit function

**Files:**
- Create: `supabase/migrations/20260726000400_feedback.sql`

**Interfaces:**
- Produces: table `booking.feedback`; `booking.fn_submit_feedback(uuid, int, text, text) returns booking.feedback`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260726000400_feedback.sql`:

```sql
-- ============================================================
-- Travelers Inn · Migration 14: guest feedback
--
-- Guests scan a QR in their room and submit a rating. The table has NO anon
-- policy: submission goes only through fn_submit_feedback (SECURITY DEFINER),
-- called from a server action. That keeps the table unreachable from the
-- browser, so it can't be scraped or spammed by direct REST calls.
-- ============================================================

create table if not exists booking.feedback (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references booking.rooms (id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  guest_name text,
  created_at timestamptz not null default now()
);
create index if not exists feedback_room_id_idx on booking.feedback (room_id);
create index if not exists feedback_created_at_idx on booking.feedback (created_at desc);

alter table booking.feedback enable row level security;

-- Staff read only. No insert policy at all — see the header.
do $$ begin
  create policy feedback_staff_read on booking.feedback for select
    using (booking.fn_is_active_user());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy feedback_admin_delete on booking.feedback for delete
    using (booking.fn_is_admin());
exception when duplicate_object then null; end $$;

create or replace function booking.fn_submit_feedback(
  p_room_id uuid,
  p_rating int,
  p_comment text default null,
  p_guest_name text default null
) returns booking.feedback language plpgsql security definer set search_path = '' as $$
declare
  v_row booking.feedback;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Please choose a rating between 1 and 5.';
  end if;
  if not exists (select 1 from booking.rooms where id = p_room_id) then
    raise exception 'That room could not be found.';
  end if;

  insert into booking.feedback (room_id, rating, comment, guest_name)
  values (p_room_id, p_rating, nullif(btrim(p_comment), ''), nullif(btrim(p_guest_name), ''))
  returning * into v_row;
  return v_row;
end;
$$;
```

- [ ] **Step 2: Apply and regenerate types**

```bash
npm run db:reset && npm run db:types
```

Expected: `feedback` appears in `database.types.ts`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260726000400_feedback.sql src/types/database.types.ts
git commit -m "feat(db): guest feedback table and submit function"
```

---

### Task B2: Feedback DB tests

**Files:**
- Create: `supabase/tests/feedback.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/feedback.test.mjs`:

```js
// Integration tests for guest feedback. The security property under test: the
// feedback table is NOT reachable from an anon client — only the SECURITY
// DEFINER function may write, and anon may not read at all.
//
// Run: npm run db:start && node supabase/tests/feedback.test.mjs
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { adminBooking, resetIdentity, SUPABASE_URL, ANON_KEY } from "./_helpers.mjs";

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function one(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  console.log("guest feedback");
  await resetIdentity();
  const b = adminBooking();
  await b.from("feedback").delete().not("id", "is", null);
  await b.from("bookings").delete().not("id", "is", null);
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);

  const { data: type } = await b
    .from("room_types")
    .insert({ name: "FB Type", base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 })
    .select("id")
    .single();
  const { data: room } = await b
    .from("rooms")
    .insert({ room_type_id: type.id, label: "F1" })
    .select("id")
    .single();

  await test("fn_submit_feedback inserts and returns the row", async () => {
    const { data, error } = await b.rpc("fn_submit_feedback", {
      p_room_id: room.id,
      p_rating: 5,
      p_comment: "Spotless and quiet.",
      p_guest_name: "Ana",
    });
    assert.equal(error, null);
    const row = one(data);
    assert.equal(row.rating, 5);
    assert.equal(row.comment, "Spotless and quiet.");
    assert.equal(row.guest_name, "Ana");
    assert.equal(row.room_id, room.id);
  });

  await test("blank comment and name normalise to null", async () => {
    const { data } = await b.rpc("fn_submit_feedback", {
      p_room_id: room.id,
      p_rating: 4,
      p_comment: "   ",
      p_guest_name: "",
    });
    const row = one(data);
    assert.equal(row.comment, null);
    assert.equal(row.guest_name, null);
  });

  await test("a rating outside 1–5 is rejected", async () => {
    const { error } = await b.rpc("fn_submit_feedback", {
      p_room_id: room.id,
      p_rating: 9,
      p_comment: "",
      p_guest_name: "",
    });
    assert.notEqual(error, null);
    assert.match(error.message, /between 1 and 5/);
  });

  await test("an unknown room is rejected", async () => {
    const { error } = await b.rpc("fn_submit_feedback", {
      p_room_id: "00000000-0000-0000-0000-000000000000",
      p_rating: 5,
      p_comment: "",
      p_guest_name: "",
    });
    assert.notEqual(error, null);
    assert.match(error.message, /could not be found/);
  });

  await test("anon cannot read the feedback table", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      db: { schema: "booking" },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await anon.from("feedback").select("id");
    assert.deepEqual(data ?? [], [], "anon must not be able to list feedback");
  });

  await test("deleting a room cascades its feedback", async () => {
    await b.from("rooms").delete().eq("id", room.id);
    const { data } = await b.from("feedback").select("id").eq("room_id", room.id);
    assert.equal(data.length, 0);
  });

  console.log(`\n${passed} passed`);
}

main();
```

- [ ] **Step 2: Run it**

```bash
node supabase/tests/feedback.test.mjs
```

Expected: `6 passed` (B1 is already applied). If it fails, re-read B1's migration.

- [ ] **Step 3: Register and run the full suite**

Append to `test:db` in `package.json`:

```
&& node supabase/tests/feedback.test.mjs
```

```bash
npm run test:db
```

Expected: 60 passing (54 + 6).

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/feedback.test.mjs package.json
git commit -m "test(db): guest feedback submission and access control"
```

---

### Task B3: Public feedback page

**Files:**
- Create: `src/lib/site.ts`
- Create: `src/features/feedback/schemas.ts`
- Create: `src/features/feedback/repository.ts`
- Create: `src/features/feedback/actions.ts`
- Create: `src/features/feedback/components/feedback-form.tsx`
- Create: `src/app/(portal)/feedback/[roomId]/page.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `SITE_URL`, `feedbackUrlFor(roomId: string): string`, `feedbackSchema`, `getRoomPublic(roomId)`, `submitFeedback(input): Promise<ActionResult<{ id: string }>>`.

- [ ] **Step 1: Extract the site URL constant**

Create `src/lib/site.ts`:

```ts
// Deliberately hardcoded rather than read from NEXT_PUBLIC_APP_URL: that env
// var isn't reliably present at build time on every deploy target, and a wrong
// value here silently breaks share cards and printed QR codes.
export const SITE_URL = "https://bti.kerisoftware.com";

// The URL encoded into each room's printed feedback QR code.
export function feedbackUrlFor(roomId: string): string {
  return `${SITE_URL}/feedback/${roomId}`;
}
```

In `src/app/layout.tsx`, replace the local `const siteUrl = "https://bti.kerisoftware.com";` with an import from `@/lib/site` and use `SITE_URL` in its place, so there is one source of truth.

- [ ] **Step 2: Write the schema**

Create `src/features/feedback/schemas.ts`:

```ts
import { z } from "zod";

export const feedbackSchema = z.object({
  room_id: z.string().uuid(),
  rating: z.coerce.number().int().min(1, "Please choose a rating").max(5),
  comment: z.string().trim().max(1000).optional().or(z.literal("")),
  guest_name: z.string().trim().max(120).optional().or(z.literal("")),
});
export type FeedbackFormValues = z.input<typeof feedbackSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;
```

- [ ] **Step 3: Write the repository**

Create `src/features/feedback/repository.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database.types";

export type FeedbackRow = Database["booking"]["Tables"]["feedback"]["Row"];
export type FeedbackWithRoom = FeedbackRow & {
  room: { label: string; room_type: { name: string } | null } | null;
};

// Public lookup for the QR landing page. Anonymous, so it goes through the
// admin client like every other portal read.
export async function getRoomPublic(
  roomId: string
): Promise<{ id: string; label: string; typeName: string | null } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("rooms")
    .select("id, label, room_type:room_types(name)")
    .eq("id", roomId)
    .maybeSingle();
  if (!data) return null;
  const rt = data.room_type as { name: string } | null;
  return { id: data.id, label: data.label, typeName: rt?.name ?? null };
}

// Staff-side read under RLS.
export async function listFeedback(): Promise<FeedbackWithRoom[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("feedback")
    .select("*, room:rooms(label, room_type:room_types(name))")
    .order("created_at", { ascending: false });
  return (data as FeedbackWithRoom[] | null) ?? [];
}

export type FeedbackStats = { count: number; average: number; last30: number };

// Pure so it can be reasoned about without a DB round-trip.
export function computeFeedbackStats(rows: FeedbackRow[], now = new Date()): FeedbackStats {
  if (rows.length === 0) return { count: 0, average: 0, last30: 0 };
  const total = rows.reduce((acc, r) => acc + r.rating, 0);
  const cutoff = now.getTime() - 30 * 86_400_000;
  return {
    count: rows.length,
    average: Math.round((total / rows.length) * 10) / 10,
    last30: rows.filter((r) => new Date(r.created_at).getTime() >= cutoff).length,
  };
}
```

- [ ] **Step 4: Write the action**

Create `src/features/feedback/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail, toActionError, type ActionResult } from "@/lib/action-result";
import { feedbackSchema } from "./schemas";

// Public, no-login submission. Goes through the admin client so
// fn_submit_feedback stays off the anon grant — the table itself is never
// reachable from the browser.
export async function submitFeedback(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = feedbackSchema.parse(input);
    const admin = createAdminClient();

    const { data, error } = await admin.rpc("fn_submit_feedback", {
      p_room_id: parsed.room_id,
      p_rating: parsed.rating,
      p_comment: parsed.comment || "",
      p_guest_name: parsed.guest_name || "",
    });
    if (error) return fail(error.message);

    const row = (Array.isArray(data) ? data[0] : data) as { id: string } | null;
    if (!row) return fail("We couldn't save your feedback. Please try again.");

    revalidatePath("/feedbacks");
    return ok({ id: row.id });
  } catch (err) {
    return toActionError(err);
  }
}
```

- [ ] **Step 5: Write the form**

Create `src/features/feedback/components/feedback-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Heart, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitFeedback } from "@/features/feedback/actions";

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

export function FeedbackForm({ roomId }: { roomId: string }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [guestName, setGuestName] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      toast.error("Please choose a rating first.");
      return;
    }
    startTransition(async () => {
      const result = await submitFeedback({
        room_id: roomId,
        rating,
        comment,
        guest_name: guestName,
      });
      if (result.ok) setDone(true);
      else toast.error(result.error);
    });
  }

  if (done) {
    return (
      <div className="border-border bg-card flex flex-col items-center gap-4 rounded-2xl border p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-rose-500/15 text-rose-600">
          <Heart className="size-7" />
        </div>
        <h2 className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold">
          Thank you!
        </h2>
        <p className="text-muted-foreground text-sm">
          Your feedback goes straight to our team. We&apos;re glad you stayed with us.
        </p>
      </div>
    );
  }

  const shown = hover || rating;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className="p-1 transition-transform hover:scale-110"
            >
              <Star
                className={`size-9 ${
                  n <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
                }`}
              />
            </button>
          ))}
        </div>
        <span className="text-muted-foreground h-5 text-sm">{RATING_WORDS[shown] ?? ""}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="comment" className="text-sm font-medium">
          How was your stay?
        </label>
        <Textarea
          id="comment"
          rows={4}
          maxLength={1000}
          placeholder="Anything you loved, or anything we could do better…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="guest_name" className="text-sm font-medium">
          Your name <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id="guest_name"
          maxLength={120}
          placeholder="Leave blank to stay anonymous"
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
        />
      </div>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send feedback"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 6: Write the page**

Create `src/app/(portal)/feedback/[roomId]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getRoomPublic } from "@/features/feedback/repository";
import { FeedbackForm } from "@/features/feedback/components/feedback-form";

export const metadata: Metadata = { title: "Share your feedback" };

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const room = await getRoomPublic(roomId);

  // A neutral message either way — never reveal whether an id exists.
  if (!room) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-5 py-24 text-center">
        <h1 className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold">
          We couldn&apos;t find that room
        </h1>
        <p className="text-muted-foreground">
          Please check the code on your room tag, or ask our front desk for help.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-12">
      <div className="mb-8 text-center">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.2em]">
          Room {room.label}
          {room.typeName ? ` · ${room.typeName}` : ""}
        </p>
        <h1 className="font-[family-name:var(--font-fraunces)] mt-2 text-3xl font-semibold tracking-tight">
          How did we do?
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          It takes fifteen seconds and helps us look after the next guest.
        </p>
      </div>
      <FeedbackForm roomId={room.id} />
    </div>
  );
}
```

- [ ] **Step 7: Verify**

```bash
npm run lint && npm run build
```

Then `npm run dev`, grab a room id from Studio, and visit `http://localhost:3000/feedback/<room-id>`. Expected: the star form renders; submitting shows the thank-you state and inserts a `booking.feedback` row.

- [ ] **Step 8: Commit**

```bash
git add src/lib/site.ts src/features/feedback src/app/\(portal\)/feedback src/app/layout.tsx
git commit -m "feat(feedback): public per-room feedback form"
```

---

### Task B4: Printable room QR codes

**Files:**
- Create: `src/app/(app)/rooms/qr/page.tsx`
- Create: `src/features/rooms/components/qr-print-button.tsx`
- Modify: `src/app/(app)/rooms/page.tsx`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Consumes: `feedbackUrlFor` (B3), `listRoomsWithType` (existing).
- Produces: `/rooms/qr` route.

- [ ] **Step 1: Add the QR dependency**

```bash
npm install qrcode && npm install -D @types/qrcode
```

Expected: `qrcode` in `dependencies`, `@types/qrcode` in `devDependencies`.

- [ ] **Step 2: Write the print button**

Create `src/features/rooms/components/qr-print-button.tsx`:

```tsx
"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QrPrintButton() {
  return (
    <Button onClick={() => window.print()} className="print:hidden">
      <Printer className="size-4" /> Print
    </Button>
  );
}
```

- [ ] **Step 3: Write the QR page**

Create `src/app/(app)/rooms/qr/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { listRoomsWithType } from "@/features/rooms/repository";
import { feedbackUrlFor } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { QrPrintButton } from "@/features/rooms/components/qr-print-button";

export const metadata: Metadata = { title: "Room QR codes" };

export default async function RoomQrPage() {
  await requireUser();
  const rooms = await listRoomsWithType();

  // Rendered server-side as inline SVG: no external image service, so the
  // codes print identically offline and cost nothing per render.
  const cards = await Promise.all(
    rooms.map(async (room) => ({
      id: room.id,
      label: room.label,
      typeName: room.room_type?.name ?? null,
      svg: await QRCode.toString(feedbackUrlFor(room.id), {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
      }),
    }))
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-end justify-between gap-4 print:hidden">
        <div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/rooms" />}
            className="text-muted-foreground -ml-2 mb-2"
          >
            <ArrowLeft className="size-4" /> Back to rooms
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Room QR codes</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Print, cut, and place one in each room. Guests scan it to leave feedback.
          </p>
        </div>
        <QrPrintButton />
      </div>

      {cards.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-12 text-center">
          No rooms yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-3">
          {cards.map((card) => (
            <div
              key={card.id}
              className="flex break-inside-avoid flex-col items-center gap-2 rounded-xl border border-neutral-300 bg-white p-4 text-center text-neutral-900"
            >
              <div className="text-lg font-semibold">Room {card.label}</div>
              {card.typeName ? (
                <div className="text-xs text-neutral-500">{card.typeName}</div>
              ) : null}
              <div
                className="size-36 [&>svg]:size-full"
                dangerouslySetInnerHTML={{ __html: card.svg }}
              />
              <div className="text-xs font-medium">Scan to share your feedback</div>
              <div className="text-[0.65rem] text-neutral-500">
                Bañares Traveler&apos;s Inn
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

> `dangerouslySetInnerHTML` is safe here: the SVG is produced by `qrcode` from a URL we build ourselves out of a UUID — no user-controlled content reaches it.

- [ ] **Step 4: Add print styles**

Append to `src/app/globals.css`:

```css
@media print {
  /* The QR sheet prints on its own — hide app chrome and force A4 margins. */
  [data-slot="sidebar"],
  [data-slot="sidebar-wrapper"] > header {
    display: none !important;
  }
  @page {
    size: A4;
    margin: 12mm;
  }
}
```

- [ ] **Step 5: Link it from the rooms page**

In `src/app/(app)/rooms/page.tsx`, add `QrCode` to the lucide import and put a second button in `PageHeader`'s `actions`, wrapping the existing content in a fragment:

```tsx
        actions={
          <div className="flex gap-2">
            <Button variant="outline" nativeButton={false} render={<Link href="/rooms/qr" />}>
              <QrCode className="size-4" /> QR codes
            </Button>
            {isAdmin && activeTypes.length > 0 ? (
              <RoomFormDialog
                roomTypes={activeTypes}
                trigger={
                  <Button>
                    <Plus className="size-4" /> Add room
                  </Button>
                }
              />
            ) : null}
          </div>
        }
```

- [ ] **Step 6: Verify**

```bash
npm run lint && npm run build
```

Then `npm run dev`, visit `/rooms/qr`. Expected: one card per room with a scannable QR. Scan one with a phone camera (or decode the SVG) — it should resolve to `https://bti.kerisoftware.com/feedback/<room-id>`. Use the browser's print preview to confirm the sidebar is hidden and cards do not split across pages.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/app/\(app\)/rooms src/features/rooms/components/qr-print-button.tsx src/app/globals.css
git commit -m "feat(rooms): printable per-room feedback QR codes"
```

---

### Task B5: Admin feedbacks page

**Files:**
- Create: `src/features/feedback/components/feedbacks-table.tsx`
- Create: `src/app/(app)/feedbacks/page.tsx`
- Modify: `src/components/layout/app-sidebar.tsx`

**Interfaces:**
- Consumes: `listFeedback`, `computeFeedbackStats`, `FeedbackWithRoom` (B3).

- [ ] **Step 1: Write the table**

Create `src/features/feedback/components/feedbacks-table.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ColumnDef } from "@tanstack/react-table";
import type { FeedbackWithRoom } from "@/features/feedback/repository";

const dt = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`size-3.5 ${
            n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
          }`}
        />
      ))}
    </span>
  );
}

const columns: ColumnDef<FeedbackWithRoom>[] = [
  {
    accessorKey: "created_at",
    header: "Date",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {dt.format(new Date(row.original.created_at))}
      </span>
    ),
  },
  {
    id: "room",
    header: "Room",
    cell: ({ row }) => {
      const room = row.original.room;
      return (
        <span className="text-sm font-medium">
          {room ? `Room ${room.label}` : "—"}
          {room?.room_type ? (
            <span className="text-muted-foreground font-normal"> · {room.room_type.name}</span>
          ) : null}
        </span>
      );
    },
  },
  {
    accessorKey: "rating",
    header: "Rating",
    cell: ({ row }) => <Stars rating={row.original.rating} />,
  },
  {
    accessorKey: "comment",
    header: "Comment",
    cell: ({ row }) => (
      <span className="text-sm">{row.original.comment ?? <span className="text-muted-foreground">—</span>}</span>
    ),
  },
  {
    accessorKey: "guest_name",
    header: "Guest",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">{row.original.guest_name ?? "Anonymous"}</span>
    ),
  },
];

export function FeedbacksTable({ feedback }: { feedback: FeedbackWithRoom[] }) {
  const [minRating, setMinRating] = useState("0");

  const rows = useMemo(
    () => feedback.filter((f) => f.rating >= Number(minRating)),
    [feedback, minRating]
  );

  const options = [
    { value: "0", label: "All ratings" },
    { value: "4", label: "4 stars and up" },
    { value: "3", label: "3 stars and up" },
    { value: "1", label: "1–2 stars (needs attention)" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Select
          items={options}
          value={minRating}
          onValueChange={(v) => setMinRating((v as string) ?? "0")}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search comments, rooms, guests…"
        emptyMessage="No feedback matches that filter."
      />
    </div>
  );
}
```

> `DataTable` already provides a global filter box when you pass `searchPlaceholder` — that is why the only extra control here is the rating select.

- [ ] **Step 2: Write the page**

Create `src/app/(app)/feedbacks/page.tsx`:

```tsx
import type { Metadata } from "next";
import { MessageSquareHeart } from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { listFeedback, computeFeedbackStats } from "@/features/feedback/repository";
import { FeedbacksTable } from "@/features/feedback/components/feedbacks-table";

export const metadata: Metadata = { title: "Feedback" };

export default async function FeedbacksPage() {
  await requireUser();
  const feedback = await listFeedback();
  const stats = computeFeedbackStats(feedback);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Guest feedback"
        description="Submitted by guests scanning the QR code in their room."
      />

      {feedback.length === 0 ? (
        <EmptyState
          icon={MessageSquareHeart}
          title="No feedback yet"
          description="Print the room QR codes and place one in each room — responses will appear here."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Average rating" value={`${stats.average} / 5`} icon={Star} />
            <StatCard label="Total responses" value={stats.count} icon={MessageSquareHeart} />
            <StatCard label="Last 30 days" value={stats.last30} icon={CalendarDays} />
          </div>
          <FeedbacksTable feedback={feedback} />
        </>
      )}
    </div>
  );
}
```

Import `CalendarDays`, `MessageSquareHeart` and `Star` from `lucide-react`. `StatCard` accepts `label`, `value` (string or number), and an optional `icon`.

- [ ] **Step 3: Add the sidebar link**

In `src/components/layout/app-sidebar.tsx`, add `MessageSquareHeart` to the lucide import and insert into `NAV` after Rooms:

```ts
  { title: "Feedback", href: "/feedbacks", icon: MessageSquareHeart },
```

- [ ] **Step 4: Verify**

```bash
npm run lint && npm run build
```

Then `npm run dev`, submit feedback from `/feedback/<room-id>`, and check `/feedbacks`. Expected: the stat cards and the row appear; the rating filter narrows the table.

- [ ] **Step 5: Commit**

```bash
git add src/features/feedback src/app/\(app\)/feedbacks src/components/layout/app-sidebar.tsx
git commit -m "feat(feedback): admin feedbacks page with stats and filtering"
```

---

# PART C — Multiple room-type photos

### Task C1: `room_type_photos` table and backfill

**Files:**
- Create: `supabase/migrations/20260726000500_room_type_photos_multi.sql`

**Interfaces:**
- Produces: table `booking.room_type_photos`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260726000500_room_type_photos_multi.sql`:

```sql
-- ============================================================
-- Travelers Inn · Migration 15: multiple photos per room type
--
-- room_types.image_url is KEPT as the cover image and stays synced to the
-- lowest-sort_order photo, so existing readers (portal cards, OG metadata, the
-- room-types table thumbnail) keep working untouched. Reuses the existing
-- PUBLIC travelers-inn-room-photos bucket and its policies — no new bucket.
-- ============================================================

create table if not exists booking.room_type_photos (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references booking.room_types (id) on delete cascade,
  storage_path text not null,
  url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists room_type_photos_room_type_id_idx
  on booking.room_type_photos (room_type_id, sort_order);

alter table booking.room_type_photos enable row level security;

-- Public read: the portal gallery is anonymous.
do $$ begin
  create policy room_type_photos_public_read on booking.room_type_photos
    for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy room_type_photos_admin_all on booking.room_type_photos for all
    using (booking.fn_is_admin())
    with check (booking.fn_is_admin());
exception when duplicate_object then null; end $$;

-- Backfill: every type that already has a cover gets a photo row, so the
-- gallery editor opens pre-populated rather than looking empty.
insert into booking.room_type_photos (room_type_id, storage_path, url, sort_order)
select rt.id, '', rt.image_url, 0
from booking.room_types rt
where rt.image_url is not null
  and rt.image_url <> ''
  and not exists (
    select 1 from booking.room_type_photos p where p.room_type_id = rt.id
  );
```

- [ ] **Step 2: Apply and regenerate types**

```bash
npm run db:reset && npm run db:types
```

Expected: `room_type_photos` appears in `database.types.ts`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260726000500_room_type_photos_multi.sql src/types/database.types.ts
git commit -m "feat(db): multiple photos per room type"
```

---

### Task C2: Photo reads and tests

**Files:**
- Modify: `src/features/rooms/repository.ts`
- Modify: `src/features/portal/repository.ts`
- Modify: `supabase/tests/rooms.test.mjs`

**Interfaces:**
- Produces: `RoomTypePhoto` type; `RoomTypeWithTiers` gains `room_type_photos: RoomTypePhoto[]`; `AvailabilityOption` gains `photos: { url: string }[]`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/tests/rooms.test.mjs`, inside `main()` before the final `console.log`:

```js
  await test("room type photos come back ordered by sort_order", async () => {
    const { data: type } = await b
      .from("room_types")
      .insert({ name: "Photo Type", base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 })
      .select("id")
      .single();

    await b.from("room_type_photos").insert([
      { room_type_id: type.id, storage_path: "c.jpg", url: "https://x.test/c.jpg", sort_order: 2 },
      { room_type_id: type.id, storage_path: "a.jpg", url: "https://x.test/a.jpg", sort_order: 0 },
      { room_type_id: type.id, storage_path: "b.jpg", url: "https://x.test/b.jpg", sort_order: 1 },
    ]);

    const { data } = await b
      .from("room_type_photos")
      .select("url, sort_order")
      .eq("room_type_id", type.id)
      .order("sort_order");
    assert.deepEqual(
      data.map((p) => p.url),
      ["https://x.test/a.jpg", "https://x.test/b.jpg", "https://x.test/c.jpg"]
    );

    // Deleting the type cascades its photos.
    await b.from("room_types").delete().eq("id", type.id);
    const { data: after } = await b
      .from("room_type_photos")
      .select("id")
      .eq("room_type_id", type.id);
    assert.equal(after.length, 0);
  });
```

- [ ] **Step 2: Run it**

```bash
node supabase/tests/rooms.test.mjs
```

Expected: PASS (C1's table exists). If it fails on an unknown relation, C1 was not applied — run `npm run db:reset`.

- [ ] **Step 3: Extend the staff repository**

In `src/features/rooms/repository.ts`:

```ts
export type RoomTypePhoto = Database["booking"]["Tables"]["room_type_photos"]["Row"];
export type RoomTypeWithTiers = RoomType & {
  rate_tiers: RateTier[];
  room_type_photos: RoomTypePhoto[];
};
```

Update the shared select and the sorter:

```ts
const TYPE_SELECT = "*, rate_tiers(*), room_type_photos(*)";

function sortTiers(t: RoomTypeWithTiers): RoomTypeWithTiers {
  return {
    ...t,
    rate_tiers: [...(t.rate_tiers ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    room_type_photos: [...(t.room_type_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  };
}
```

- [ ] **Step 4: Extend the portal repository**

In `src/features/portal/repository.ts`, update `TYPE_SELECT` to `"*, rate_tiers(*), room_type_photos(*)"`, add `photos: { url: string }[]` to `AvailabilityOption`, sort photos in `withActiveTiers`, and populate the field in `toOption`:

```ts
    photos: (t.room_type_photos ?? []).map((p) => ({ url: p.url })),
```

- [ ] **Step 5: Verify**

```bash
npm run lint && npm run build && npm run test:db
```

Expected: all pass; 61 tests (60 + 1).

- [ ] **Step 6: Commit**

```bash
git add src/features/rooms/repository.ts src/features/portal/repository.ts supabase/tests/rooms.test.mjs
git commit -m "feat(rooms): read room-type photo galleries"
```

---

### Task C3: Multi-photo editing in the room-type form

**Files:**
- Create: `src/features/rooms/components/photos-field.tsx`
- Create: `src/features/rooms/components/tier-row.tsx`
- Modify: `src/features/rooms/components/room-type-form-dialog.tsx`
- Modify: `src/features/rooms/schemas.ts`
- Modify: `src/features/rooms/actions.ts`

**Interfaces:**
- Consumes: `uploadRoomTypePhoto` (existing), `RoomTypeWithTiers` with photos (C2).
- Produces: `roomTypeSchema` gains `photos: { url: string; storage_path: string }[]`; `saveRoomType` reconciles them and syncs `image_url` to the first.

> **Why the extraction:** `room-type-form-dialog.tsx` is already 342 lines and this task adds a gallery editor. Moving `TierRow` and the new `PhotosField` into their own files keeps the dialog a readable composition root. This is a targeted improvement to code this task touches — do not restructure anything else.

- [ ] **Step 1: Extend the schema**

In `src/features/rooms/schemas.ts`, add above `roomTypeSchema`:

```ts
// One uploaded gallery image. Order in the array IS the display order; the
// first is the cover, mirrored onto room_types.image_url on save.
export const roomTypePhotoSchema = z.object({
  id: z.string().uuid().optional(),
  url: z.string().url(),
  storage_path: z.string().default(""),
});
export type RoomTypePhotoValues = z.input<typeof roomTypePhotoSchema>;
```

and add to the `roomTypeSchema` object (keep `image_url` — it is now derived):

```ts
    photos: z.array(roomTypePhotoSchema).default([]),
```

- [ ] **Step 2: Extract `TierRow`**

Create `src/features/rooms/components/tier-row.tsx` containing the existing `TierRow` function and `kindOptions` constant moved verbatim from `room-type-form-dialog.tsx`, with these imports:

```tsx
"use client";

import { useWatch, type Control } from "react-hook-form";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormInput, FormSelect } from "@/components/shared/form-fields";
import { TIER_KINDS, TIER_KIND_LABELS, type RoomTypeFormValues } from "@/features/rooms/schemas";

const kindOptions = TIER_KINDS.map((k) => ({ value: k, label: TIER_KIND_LABELS[k] }));
```

Export it: `export function TierRow({ ... })`.

- [ ] **Step 3: Write `PhotosField`**

Create `src/features/rooms/components/photos-field.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { useFieldArray, type Control } from "react-hook-form";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadRoomTypePhoto } from "@/features/rooms/actions";
import type { RoomTypeFormValues } from "@/features/rooms/schemas";

// Gallery editor. Order in the array is the display order — the first photo is
// the cover and is mirrored onto room_types.image_url when the form is saved.
// Reorder uses buttons rather than drag-and-drop: keyboard-accessible, and far
// less code to get right.
export function PhotosField({ control }: { control: Control<RoomTypeFormValues> }) {
  const photos = useFieldArray({ control, name: "photos" });
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    if (files.length === 0) return;

    setUploading(true);
    for (const file of files) {
      const data = new FormData();
      data.set("file", file);
      const result = await uploadRoomTypePhoto(data);
      if (result.ok) {
        photos.append({ url: result.data.url, storage_path: "" });
      } else {
        toast.error(`${file.name}: ${result.error}`);
      }
    }
    setUploading(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Photos</span>
        <span className="text-muted-foreground text-xs">
          The first photo is the cover · JPEG, PNG, or WebP up to 5 MB
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onPick}
      />

      <div className="grid grid-cols-3 gap-2">
        {photos.fields.map((field, i) => (
          <div
            key={field.id}
            className="border-border group relative aspect-4/3 overflow-hidden rounded-lg border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={(field as unknown as { url: string }).url}
              alt={`Room photo ${i + 1}`}
              className="size-full object-cover"
            />
            {i === 0 ? (
              <span className="bg-primary text-primary-foreground absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[0.65rem] font-medium">
                Cover
              </span>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute right-1.5 top-1.5"
              aria-label={`Remove photo ${i + 1}`}
              onClick={() => photos.remove(i)}
            >
              <X className="size-3.5" />
            </Button>
            <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between">
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                disabled={i === 0}
                aria-label={`Move photo ${i + 1} earlier`}
                onClick={() => photos.move(i, i - 1)}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                disabled={i === photos.fields.length - 1}
                aria-label={`Move photo ${i + 1} later`}
                onClick={() => photos.move(i, i + 1)}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          className="text-muted-foreground aspect-4/3 h-auto flex-col gap-1.5 border-dashed"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              <span className="text-xs">Uploading…</span>
            </>
          ) : (
            <>
              <ImagePlus className="size-5" />
              <span className="text-xs">Add photos</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewire the dialog**

In `src/features/rooms/components/room-type-form-dialog.tsx`:

- Delete the local `TierRow` function, the `PhotoField` function, and the `kindOptions` constant.
- Replace their imports with:

```tsx
import { TierRow } from "./tier-row";
import { PhotosField } from "./photos-field";
```

- Remove now-unused imports (`ImagePlus`, `Loader2`, `X`, `useRef`, `useWatch`, `Control`, `UseFormSetValue`, `FormSelect`).
- Replace `<PhotoField control={form.control} setValue={form.setValue} />` with `<PhotosField control={form.control} />`.
- In `defaults()`, add:

```ts
    photos:
      roomType?.room_type_photos.map((p) => ({
        id: p.id,
        url: p.url,
        storage_path: p.storage_path,
      })) ?? [],
```

- [ ] **Step 5: Reconcile photos on save**

In `src/features/rooms/actions.ts`, inside `saveRoomType`, set the cover from the first photo:

```ts
    const row = {
      name: parsed.name,
      description: parsed.description || null,
      // The cover mirrors the first gallery photo so existing single-image
      // readers (portal cards, OG metadata) keep working unchanged.
      image_url: parsed.photos[0]?.url ?? null,
      base_occupancy: parsed.base_occupancy,
      max_occupancy: parsed.max_occupancy,
      excess_person_rate: parsed.excess_person_rate,
      is_active: parsed.is_active,
    };
```

After `syncRateTiers`, add:

```ts
    const photoError = await syncPhotos(supabase, id, parsed.photos);
    if (photoError) return fail(photoError);
```

And add the helper beside `syncRateTiers`:

```ts
type PhotoInput = z.infer<typeof roomTypeSchema>["photos"][number];

// Photos have no FK dependents (unlike rate tiers, which bookings reference),
// so removed ones are hard-deleted. Array position becomes sort_order.
async function syncPhotos(
  supabase: SupabaseClient,
  roomTypeId: string,
  photos: PhotoInput[]
): Promise<string | null> {
  const { error: delError } = await supabase
    .from("room_type_photos")
    .delete()
    .eq("room_type_id", roomTypeId);
  if (delError) return delError.message;

  if (photos.length === 0) return null;

  const { error } = await supabase.from("room_type_photos").insert(
    photos.map((p, i) => ({
      room_type_id: roomTypeId,
      storage_path: p.storage_path || "",
      url: p.url,
      sort_order: i,
    }))
  );
  return error ? error.message : null;
}
```

- [ ] **Step 6: Verify**

```bash
npm run lint && npm run build
```

Then `npm run dev`, go to `/room-types`, edit a type, add three photos, reorder them, save, and reopen. Expected: order persists, the first is badged "Cover", and the room-types table thumbnail shows that cover.

- [ ] **Step 7: Commit**

```bash
git add src/features/rooms
git commit -m "feat(rooms): multi-photo gallery editor for room types"
```

---

### Task C4: Portal gallery

**Files:**
- Create: `src/features/portal/components/room-gallery.tsx`
- Modify: `src/app/(portal)/book/page.tsx`

**Interfaces:**
- Consumes: `AvailabilityOption.photos` (C2), `RoomVisual` (existing fallback).

- [ ] **Step 1: Write the gallery**

Create `src/features/portal/components/room-gallery.tsx`:

```tsx
"use client";

import { useState } from "react";
import { RoomVisual } from "./room-visual";

// Main image + thumbnail strip — the familiar hotel-booking pattern. Falls back
// to the gradient RoomVisual when a type has no photos, so nothing regresses
// for types that were never given images.
export function RoomGallery({
  name,
  photos,
  className,
}: {
  name: string;
  photos: { url: string }[];
  className?: string;
}) {
  const [active, setActive] = useState(0);

  if (photos.length === 0) {
    return <RoomVisual name={name} className={className ?? "h-56"} />;
  }

  const current = photos[Math.min(active, photos.length - 1)];

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-muted relative overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={`${name} — photo ${active + 1} of ${photos.length}`}
          className="h-56 w-full object-cover sm:h-64"
        />
      </div>

      {photos.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((photo, i) => (
            <button
              type="button"
              key={photo.url}
              onClick={() => setActive(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === active}
              className={`size-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                i === active ? "border-primary" : "border-transparent hover:border-foreground/20"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Use it on the book page**

In `src/app/(portal)/book/page.tsx`, replace the `RoomVisual` import with:

```tsx
import { RoomGallery } from "@/features/portal/components/room-gallery";
```

and swap the element. Since the gallery is no longer a flush-to-edge banner, move it inside the padded area:

```tsx
        <div className="border-border bg-card flex flex-col overflow-hidden rounded-2xl border">
          <div className="p-3 pb-0">
            <RoomGallery name={option.name} photos={option.photos} />
          </div>
          <div className="flex flex-col gap-4 p-6">
```

- [ ] **Step 3: Verify**

```bash
npm run lint && npm run build
```

Then `npm run dev`, search dates on `/`, open a room type that has multiple photos. Expected: large photo with a thumbnail strip; clicking a thumbnail swaps the main image. A type with no photos still shows the gradient.

- [ ] **Step 4: Commit**

```bash
git add src/features/portal src/app/\(portal\)/book/page.tsx
git commit -m "feat(portal): room photo gallery on the booking page"
```

---

# PART D — Google Map

### Task D1: "Find us" map section

**Files:**
- Create: `src/features/portal/components/find-us.tsx`
- Modify: `src/app/(portal)/page.tsx`
- Modify: `src/app/(portal)/layout.tsx`

**Interfaces:**
- Consumes: `getPublicSettings` (A1), `isSet` (A1).

- [ ] **Step 1: Write the component**

Create `src/features/portal/components/find-us.tsx`:

```tsx
import { MapPin, Navigation } from "lucide-react";
import { isSet } from "@/features/settings/schemas";

// A plain google.com/maps embed — deliberately NOT the official Maps Embed API,
// which needs an API key and a billing account. Renders nothing until an admin
// has set the coordinates at /settings, so an unconfigured install degrades
// quietly instead of showing a map of nowhere.
export function FindUs({
  address,
  lat,
  lng,
}: {
  address: string;
  lat: string;
  lng: string;
}) {
  if (!isSet(lat) || !isSet(lng)) return null;

  const coords = `${lat},${lng}`;
  const embedSrc = `https://www.google.com/maps?q=${encodeURIComponent(coords)}&z=17&output=embed`;
  const directionsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coords)}`;

  return (
    <section className="border-border border-t bg-[oklch(0.99_0.006_85)]">
      <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-8 md:grid-cols-[1fr_1.4fr] md:items-center">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 text-sm font-medium uppercase tracking-[0.22em] text-[oklch(0.5_0.09_60)]">
              <span className="h-px w-8 bg-[oklch(0.62_0.13_55)]" />
              Find us
            </p>
            <h2 className="font-[family-name:var(--font-fraunces)] text-3xl font-semibold tracking-tight">
              Easy to reach, easy to rest
            </h2>
            {isSet(address) ? (
              <p className="text-muted-foreground mt-4 flex items-start gap-2 text-sm leading-relaxed">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <span>{address}</span>
              </p>
            ) : null}
            <a
              href={directionsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary text-primary-foreground mt-6 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
            >
              <Navigation className="size-4" /> Get directions
            </a>
          </div>

          <div className="border-border overflow-hidden rounded-2xl border shadow-sm">
            <iframe
              src={embedSrc}
              title="Map showing Bañares Traveler's Inn"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-72 w-full border-0 sm:h-80"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Mount it on the portal home**

In `src/app/(portal)/page.tsx`, add the imports:

```tsx
import { FindUs } from "@/features/portal/components/find-us";
import { getPublicSettings } from "@/features/settings/repository";
```

Fetch settings alongside the availability query:

```tsx
  const [options, settings] = await Promise.all([
    listPortalAvailability(localToISO(win.checkIn), localToISO(win.checkOut)),
    getPublicSettings(),
  ]);
```

(remove the now-duplicated standalone `const options = await …` line), and render the section after the results `</section>`, before the closing `</div>`:

```tsx
      <FindUs
        address={settings.inn_address}
        lat={settings.inn_map_lat}
        lng={settings.inn_map_lng}
      />
```

- [ ] **Step 3: Show the address in the footer**

In `src/app/(portal)/layout.tsx`, make the component `async`, fetch the settings, and render the address under the tagline when it is set:

```tsx
import { getPublicSettings } from "@/features/settings/repository";
import { isSet } from "@/features/settings/schemas";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const settings = await getPublicSettings();
```

Then inside the footer, directly after the "A warm welcome, any hour of the day." paragraph:

```tsx
              {isSet(settings.inn_address) ? (
                <p className="text-muted-foreground mt-1 text-sm">{settings.inn_address}</p>
              ) : null}
```

- [ ] **Step 4: Verify**

```bash
npm run lint && npm run build
```

Then `npm run dev`. With the seeded `TODO_REPLACE` values, `/` shows **no** map section and no footer address. Set a real address and coordinates at `/settings` (e.g. `12.9742` / `123.9967`), reload `/`. Expected: the map renders, "Get directions" opens Google Maps at those coordinates, and the footer shows the address.

- [ ] **Step 5: Commit**

```bash
git add src/features/portal/components/find-us.tsx src/app/\(portal\)/page.tsx src/app/\(portal\)/layout.tsx
git commit -m "feat(portal): Find us map section and footer address"
```

---

## Final verification

- [ ] **Run the full suite**

```bash
npm run db:reset && npm run test:db
```

Expected: **61 passing** — 40 original + 7 verification + 7 deposit + 6 feedback + 1 photos. The reports and pricing suites are untouched; if `bookings.test.mjs` or `front-desk.test.mjs` regress, the exclusion-constraint change in Task A3 is at fault.

- [ ] **Lint and build**

```bash
npm run lint && npm run build
```

- [ ] **Route smoke test** — with `npm run dev`, walk: portal search → book with deposit + proof → staff `/bookings` shows "For verification" → confirm → payment recorded; `/rooms/qr` prints; scan → `/feedback/<id>` → submit → `/feedbacks` shows it; `/room-types` multi-photo edit → portal gallery; `/settings` map values → "Find us" appears.

- [ ] **Update `CLAUDE.md`** — add a milestone entry recording: the `pending_verification` status and its inclusion in `no_overlap`; `booking.settings` as the config store; the private `travelers-inn-payment-proofs` bucket; `fn_create_booking`'s new `p_status` parameter; the feedback table reachable only via `fn_submit_feedback`; `room_type_photos` with `image_url` retained as the synced cover; and the new test counts.

---

## Open items

- **Inn address and coordinates** are seeded as `TODO_REPLACE`. The map and footer address stay hidden until an admin sets real values at `/settings`. Not a blocker — no code change needed.
