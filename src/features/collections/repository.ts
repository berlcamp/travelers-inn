import { createClient } from "@/lib/supabase/server";
import { resolveStaffNames } from "@/features/bookings/repository";
import { PAYMENT_METHODS, type PaymentMethod } from "@/features/bookings/payment-schema";
import {
  computeCollectionsReport,
  rangeBounds,
  NO_COLLECTION_FILTERS,
  type CollectionsFilters,
  type CollectionsReport,
  type ReportPayment,
} from "@/features/reports/analytics";

/**
 * A payment as the remittance sheet needs to show it: the report maths only
 * touches amount/method/date/recorder, so the extra columns ride along as an
 * extension of ReportPayment rather than widening that type for a page that
 * doesn't use them.
 */
export type CollectionRow = ReportPayment & {
  roomLabel: string;
  roomTypeName: string;
  /** The booking's channel — a portal deposit and a walk-in settlement read
   *  very differently when reconciling a shift. */
  source: string;
};

type RawPayment = {
  id: string;
  booking_id: string;
  amount: number;
  method: string;
  reference: string | null;
  created_at: string;
  recorded_by: string | null;
  booking: {
    reference_code: string;
    guest_name: string;
    source: string;
    room: { label: string } | null;
    room_type: { name: string } | null;
  } | null;
};

// One round-trip: the booking (and through it the room and its type) is
// embedded rather than fetched per payment. Everything here is inside RLS —
// `payments_staff_read` lets any active staff member read the ledger, which is
// what makes a front-desk remittance sheet possible without a SECURITY DEFINER
// reader. Staff NAMES still go through fn_staff_names, because `profiles` is
// self-only for front desk (it carries emails).
const COLLECTION_SELECT =
  "id, booking_id, amount, method, reference, created_at, recorded_by, " +
  "booking:bookings(reference_code, guest_name, source, room:rooms(label), room_type:room_types(name))";

/**
 * Collections received in [from, to] (both inclusive dates), narrowed by
 * `filters`.
 *
 * The staff filter is applied HERE, in the query, rather than only in the pure
 * maths: a front-desk user gets their own sheet and nobody else's, and sending
 * the whole inn's ledger to the server just to drop most of it would make that
 * an accident away from leaking. The caller decides whose id goes in — the page
 * pins it to the signed-in user for anyone who isn't an admin.
 */
export async function getCollections(
  from: string,
  to: string,
  filters: CollectionsFilters = NO_COLLECTION_FILTERS
): Promise<CollectionsReport<CollectionRow>> {
  const supabase = await createClient();
  const { start, end } = rangeBounds(from, to);

  let query = supabase
    .from("payments")
    .select(COLLECTION_SELECT)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  if (filters.staffId) query = query.eq("recorded_by", filters.staffId);
  // `method` is a plain string on CollectionsFilters (analytics.ts stays free
  // of imports so it can unit-test under --experimental-strip-types), so it is
  // re-narrowed here against the enum. A value that isn't a payment_method
  // would otherwise reach Postgres as a cast error rather than as "no match".
  if (filters.method && (PAYMENT_METHODS as readonly string[]).includes(filters.method)) {
    query = query.eq("method", filters.method as PaymentMethod);
  }

  const { data } = await query.order("created_at");
  const rows = (data ?? []) as unknown as RawPayment[];

  const names = await resolveStaffNames(rows.map((p) => p.recorded_by));

  const payments: CollectionRow[] = rows.map((p) => ({
    id: p.id,
    bookingId: p.booking_id,
    // A payment can't exist without its booking (FK, cascade delete), so the
    // embed is only ever null if RLS hid the booking — which can't happen for
    // an active staff member. Fall back visibly rather than crash.
    bookingRef: p.booking?.reference_code ?? "—",
    guestName: p.booking?.guest_name ?? "—",
    roomLabel: p.booking?.room?.label ?? "",
    roomTypeName: p.booking?.room_type?.name ?? "",
    source: p.booking?.source ?? "",
    amount: Number(p.amount),
    method: p.method,
    reference: p.reference,
    createdAt: p.created_at,
    recordedBy: p.recorded_by,
    recordedByName: p.recorded_by ? (names.get(p.recorded_by) ?? null) : null,
  }));

  // The filters are passed on as well as pre-applied: the maths is what the
  // unit tests exercise, and it must produce the same answer whether the rows
  // arrived pre-narrowed or not.
  return computeCollectionsReport({ from, to, payments, filters });
}

/**
 * The staff picker's options — admin only, because only an admin may look at
 * someone else's sheet. Deactivated staff are kept: last month's remittance has
 * to be able to name whoever was on the desk then, even if they've since left.
 */
export async function listCollectionStaff(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name").order("full_name");
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name || "Unnamed staff" }));
}
