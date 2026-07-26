# Travelers Inn — Deposits, Verification, Feedback & Media

**Date:** 2026-07-26
**Status:** Approved — ready for planning
**Supersedes nothing.** Extends the shipped M1–M6 product and the tiered-pricing
revision.

---

## Summary

Five related additions to the live product:

1. **Deposit-gated portal booking** — the guest pays 50% up front via GCash or
   bank transfer and uploads proof; the booking is held but not yet confirmed.
2. **"For verification" status + admin confirm** — staff inspect the proof and
   confirm or reject.
3. **Per-room feedback QR codes + an admin Feedbacks page.**
4. **Multiple photos per room type**, shown as a gallery on the portal.
5. **A Google Map** of the inn on the portal.

Items 1 and 2 are one feature split across two surfaces and must ship together;
3, 4 and 5 are independent and can ship in any order.

---

## 1. Deposit-gated booking and verification

### The core invariant

The system's central guarantee is the `no_overlap` GiST exclusion constraint on
`booking.bookings`: no two *active* bookings may overlap on the same room.
Today "active" means `status in ('confirmed', 'checked_in')`.

A guest who has paid a real deposit must not lose the room to someone who books
a moment later. Therefore **`pending_verification` is an active status** and
joins the exclusion constraint:

```sql
alter table booking.bookings drop constraint no_overlap;
alter table booking.bookings
  add constraint no_overlap
  exclude using gist (room_id with =, period with &&)
  where (status in ('pending_verification', 'confirmed', 'checked_in'));
```

Consequences, accepted deliberately:

- A pending booking holds inventory until staff act on it. Mitigation is
  operational, not technical: the Bookings page surfaces pending bookings
  prominently with an age indicator so they get resolved same-day. No
  auto-expiry job — it was considered and dropped as premature.
- `fn_create_booking`'s room-scanning loop already treats an
  `exclusion_violation` as "try the next free room", and `fn_count_available` /
  `fn_available_rooms` filter on the same status list. All three must be updated
  to include `pending_verification` so availability counts stay truthful.

### Schema changes

**Enum.** Add `'pending_verification'` to `booking.booking_status` via
`alter type ... add value if not exists`, which is re-applyable.

> **This must be its own migration file, applied and committed before any
> migration that references the value.** Postgres refuses to *use* a newly added
> enum value in the same transaction that added it ("unsafe use of new value of
> enum type"), and each migration file runs in a transaction. The exclusion
> constraint below names `'pending_verification'` in its `WHERE` clause, so
> putting both in one file would fail on a clean `db:reset`. Hence
> `..._add_pending_status.sql` is separate from
> `..._booking_verification.sql`.

**`booking.settings`** — key/value configuration editable without a deploy.

| column | type | notes |
| --- | --- | --- |
| `key` | `text` primary key | |
| `value` | `text` | |
| `is_public` | `boolean` not null default false | gates anon read |
| `updated_at` | `timestamptz` | via existing `set_updated_at` trigger |

Seeded keys: `gcash_name`, `gcash_number`, `bank_name`, `bank_account_name`,
`bank_account_number`, `deposit_percent` (default `50`), `inn_address`,
`inn_map_lat`, `inn_map_lng`. Address and coordinates seed with a
`TODO_REPLACE` sentinel value; the UI hides the map section when the sentinel is
still present, so an unconfigured install degrades quietly rather than showing a
map of nowhere.

RLS: public read where `is_public`, admin-only write. Payment details and map
values are public; nothing secret is ever stored here.

**`booking.booking_proofs`** — one row per proof submission.

| column | type | notes |
| --- | --- | --- |
| `id` | `uuid` pk | |
| `booking_id` | `uuid` not null → `bookings(id)` on delete cascade | |
| `method` | `booking.payment_method` | constrained to `gcash` / `bank_transfer` |
| `reference_no` | `text` | guest-entered transaction reference |
| `declared_amount` | `numeric(10,2)` not null check > 0 | what the guest says they sent |
| `storage_path` | `text` not null | object key in the private bucket |
| `created_at` | `timestamptz` | |

RLS: staff read/write only. No anon policy — the portal writes via the admin
client inside a server action, matching how `createPortalBooking` already works.

**Private storage bucket `travelers-inn-payment-proofs`.** Unlike the existing
room-photo bucket this is **not public**: proofs are financial documents
carrying names and reference numbers. No `select` policy for anon; staff read
through short-lived signed URLs minted server-side. Policies are scoped by
`bucket_id` exactly like the room-photo bucket, so they remain strictly additive
in this shared Supabase project.

**`fn_create_booking`** gains a trailing `p_status booking.booking_status
default 'confirmed'` parameter. The portal passes `'pending_verification'`;
walk-in and staff bookings keep the default and are unaffected. Pricing stays
authoritative in the database — the deposit is derived from the returned
`quoted_total`, never trusted from the client.

### Deposit calculation

A pure function in `features/bookings/deposit.ts`:

```ts
depositFor(total: number, percent: number): number
```

Rounds to two decimals, floors at 0, and is unit-tested. The percent comes from
`settings.deposit_percent`. The portal displays the amount; the server
recomputes it rather than reading it back from the form.

### Portal flow

`PortalBookingForm` gains a second step after contact details:

1. **Details** — name, phone, email, guests, tier (unchanged).
2. **Payment** — shows "Pay ₱X now (50% of ₱Y)", the GCash and bank details
   from settings, a payment-method choice, a reference-number field, and a
   **required** proof upload (JPEG/PNG/WebP/PDF, ≤ 5 MB).

Submission is a single server action, `createPortalBookingWithProof`, which:

- parses the extended `portalBookingSchema` (adds `method`, `reference_no`,
  `declared_amount`, and the file),
- keeps the existing future-date and `MAX_NIGHTS` guards,
- uploads the file to the private bucket **first**, so a storage failure never
  leaves a booking without its proof,
- calls `fn_create_booking` with `p_status = 'pending_verification'`,
- inserts the `booking_proofs` row,
- writes an audit entry `booking.portal_create_pending`,
- revalidates `/`, `/bookings`, `/calendar`.

If `fn_create_booking` fails after a successful upload, the orphaned object is
deleted on the error path.

The confirmation screen changes from "Confirmed" to **"Reserved — we're
verifying your payment"**, still showing the reference code, the amount paid,
and what happens next.

### Staff flow

- **Bookings list** — `pending_verification` renders as a `For verification`
  badge (warning variant) via `BookingStatusBadge`, plus a filter for it and a
  count on the page header so it reads as a work queue.
- **Booking manage dialog** — a new verification panel appears for pending
  bookings: the proof image (signed URL, `<img>` for images, download link for
  PDFs), declared amount, reference number, method, and two actions.
  - **Confirm** — inserts a `payments` row for the verified amount (the existing
    `sync_payment_status` trigger then moves `payment_status` to `partial` or
    `paid`) and sets status to `confirmed`.
  - **Reject** — sets status to `cancelled` with the reason appended to `notes`,
    freeing the room. Staff phone the guest using the number the portal
    requires. *(Assumption: no guest-facing re-upload flow — that would need an
    authenticated guest link, which is out of scope.)*

Both actions live in `features/bookings/front-desk-actions.ts` beside the
existing helpers, guard with `requireRole`, and write audit entries
(`booking.verify_confirm`, `booking.verify_reject`).

### Admin settings page

New `/settings` route, admin-only, in the `(app)` group: a form over the
`booking.settings` rows — payment details, deposit percent, inn address and
coordinates. Single `saveSettings` action doing an upsert per key.

---

## 2. Room QR codes and guest feedback

### Schema

**`booking.feedback`**

| column | type | notes |
| --- | --- | --- |
| `id` | `uuid` pk | |
| `room_id` | `uuid` not null → `rooms(id)` on delete cascade | |
| `rating` | `int` not null check between 1 and 5 | |
| `comment` | `text` | |
| `guest_name` | `text` | optional |
| `created_at` | `timestamptz` | |

RLS: staff read only; **no anon insert policy**. Submission goes through
`booking.fn_submit_feedback(p_room_id, p_rating, p_comment, p_guest_name)`,
`SECURITY DEFINER`, called from a server action via the admin client. The table
is never directly reachable from the browser, so it cannot be scraped or
spammed by direct REST calls.

### Public feedback route

`/feedback/[roomId]` in the `(portal)` group — no login. Shows the room label
(looked up server-side; an unknown id renders a neutral "room not found" state
rather than leaking whether an id exists), a five-star picker, a comment
textarea, an optional name field, and a thank-you state after submit. Styled to
match the portal's editorial look.

### Printable QR codes

`/rooms/qr` in the `(app)` group. Renders one card per room — room label, room
type, the QR, and "Scan to share your feedback" — in a print-friendly grid with
an `@media print` stylesheet sized for A4, plus a Print button.

QR codes are generated **server-side as inline SVG** using the `qrcode` npm
package (new dependency). No external image service: the codes are rendered
from our own data, work without network access at print time, and cost nothing.
Each encodes `https://bti.kerisoftware.com/feedback/<room-id>`, built from the
same hardcoded `siteUrl` constant already used for Open Graph metadata in
`src/app/layout.tsx` — extracted to `src/lib/site.ts` so both callers share one
source of truth.

### Admin Feedbacks page

`/feedbacks` in the `(app)` group, in the sidebar under Manage:

- stat cards — average rating, total responses, responses in the last 30 days;
- a `DataTable` of every submission: date, room, star rating, comment, name;
- filter by room and by minimum rating.

Reads go through `features/feedback/repository.ts` using the RLS-scoped server
client.

---

## 3. Multiple room-type photos

### Schema

**`booking.room_type_photos`**

| column | type | notes |
| --- | --- | --- |
| `id` | `uuid` pk | |
| `room_type_id` | `uuid` not null → `room_types(id)` on delete cascade | |
| `storage_path` | `text` not null | |
| `url` | `text` not null | public URL, denormalised for cheap reads |
| `sort_order` | `int` not null default 0 | |
| `created_at` | `timestamptz` | |

Public read (the portal is anonymous), admin write. Reuses the existing public
`travelers-inn-room-photos` bucket and its policies — no new bucket.

`room_types.image_url` is **kept** rather than dropped: it stays as the cover
image and is synced to the lowest-`sort_order` photo on every save. Existing
reads (`AvailabilityOption.imageUrl`, `RoomVisual`, the room-types table
thumbnail, OG metadata) keep working untouched. The migration backfills a
`room_type_photos` row from any existing `image_url`.

### Admin editing

`PhotoField` in `room-type-form-dialog.tsx` becomes `PhotosField`: a grid of
uploaded photos with per-photo remove and reorder controls (up/down buttons —
keyboard-accessible and simpler than drag-and-drop), the first marked
**Cover**, and an add tile. Multi-select upload is supported; uploads run
through the existing `uploadRoomTypePhoto` action, which already validates type
and size.

The room-type form's `tiers` array already uses `useFieldArray`; photos follow
the same pattern, and `saveRoomType` reconciles photos the way
`syncRateTiers` reconciles tiers — except photos have no FK dependents, so
removed photos are hard-deleted (row and storage object both).

**File-size note.** `room-type-form-dialog.tsx` is already 342 lines and this
adds to it. `PhotosField` and `TierRow` move to their own files under
`features/rooms/components/` so the dialog stays a readable composition root.
This is a targeted improvement to code the work touches, not a general refactor.

### Portal display

A new `RoomGallery` component replaces `RoomVisual` on `/book`: a large main
photo with a thumbnail strip beneath it; clicking a thumbnail swaps the main
image. When a room type has no photos it falls back to the existing gradient
`RoomVisual`, so nothing regresses for types that were never given images.
`RoomTypeCard` on the home grid continues to show the cover only.

`listPortalAvailability` and `getRoomTypePublic` extend their select to include
`room_type_photos(*)`, ordered by `sort_order`, and `AvailabilityOption` gains
a `photos: { url: string }[]` field.

---

## 4. Google Map

A "Find us" section above the portal footer on the home page: an embedded map,
the address text, and a "Get directions" button deep-linking to Google Maps.

The embed is a plain iframe:

```
https://www.google.com/maps?q=<lat>,<lng>&output=embed
```

This needs **no API key and no billing account**, unlike the official Maps
Embed API. The iframe is lazy-loaded (`loading="lazy"`) so it costs nothing on
first paint.

Address and coordinates come from `booking.settings`, so they are editable from
`/settings`. While the seeded `TODO_REPLACE` sentinel is present the section is
hidden entirely.

---

## Testing

Following the project convention — DB-level integration tests in
`supabase/tests/*.mjs` against a real local stack, pure functions unit-tested
with `node --experimental-strip-types`.

**`verification.test.mjs`** (new)

- a `pending_verification` booking blocks an overlapping booking on the same room
  (the exclusion constraint covers the new status);
- `fn_count_available` excludes rooms held by a pending booking;
- confirming writes a `payments` row and moves `payment_status` to `partial`;
- rejecting sets `cancelled` and frees the room for a new booking;
- `fn_create_booking` still defaults to `confirmed` when `p_status` is omitted
  (walk-ins unaffected).

**`feedback.test.mjs`** (new)

- `fn_submit_feedback` inserts and returns the row;
- ratings outside 1–5 are rejected by the check constraint;
- anon cannot select from `booking.feedback` directly.

**`rooms.test.mjs`** (extend)

- photos come back ordered by `sort_order`;
- deleting a room type cascades its photos;
- `image_url` tracks the cover photo.

**`deposit.test.ts`** (new, pure) — rounding, zero total, non-50 percentages.

Existing suites must keep passing unchanged; `bookings.test.mjs` and
`front-desk.test.mjs` are the regression guard for the exclusion-constraint
change.

---

## Migration plan

One migration per concern, all idempotent-friendly, applied to the hosted DB
manually by the user:

| file | contents |
| --- | --- |
| `20260726000100_settings.sql` | `booking.settings` + seed + RLS |
| `20260726000200_add_pending_status.sql` | **only** `alter type booking.booking_status add value if not exists 'pending_verification'` — isolated for the transaction reason above |
| `20260726000300_booking_verification.sql` | exclusion constraint, `booking_proofs`, private bucket + policies, `fn_create_booking` / `fn_count_available` / `fn_available_rooms` updates |
| `20260726000400_feedback.sql` | `booking.feedback`, `fn_submit_feedback`, RLS |
| `20260726000500_room_type_photos_multi.sql` | `room_type_photos` table, RLS, backfill from `image_url` |

`npm run db:types` after applying; `npm run lint && npm run build` before close.

---

## Out of scope

- Automatic payment verification against GCash or bank APIs — proofs are
  inspected by a human.
- Guest self-service re-upload after a rejection.
- Auto-expiry of stale pending bookings.
- Public display of feedback as portal testimonials.
- Refund tracking for rejected bookings.

---

## Open items

- **Inn address and coordinates** are not yet supplied. They seed as
  `TODO_REPLACE` and are set from `/settings` after deploy; the map section
  stays hidden until then. Not a blocker for implementation.
