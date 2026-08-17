// Pure unit tests for the /bookings list order. Run with:
//   node --experimental-strip-types supabase/tests/booking-order.test.ts
//
// The order this replaced was `order by period desc` in SQL, which sorts a
// tstzrange by its lower bound — so a September reservation outranked tonight's
// arrivals and the guests actually in the building sat near the bottom. These
// tests are mostly about the three bands and about the order being TOTAL: a
// list that reshuffles between reloads is a list nobody trusts.
import assert from "node:assert/strict";
import {
  bandOf,
  sortForFrontDesk,
  type OrderableBooking,
} from "../../src/features/bookings/booking-order.ts";

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

// Absolute instants with an offset, exactly as Postgres hands them back — the
// sort compares moments, not strings, so the offset here is not decoration.
function bk(ref: string, status: string, checkIn: string, checkOut = ""): OrderableBooking {
  return {
    reference_code: ref,
    status,
    checkIn: checkIn ? `${checkIn}+08:00` : "",
    checkOut: checkOut ? `${checkOut}+08:00` : checkIn ? `${checkIn}+08:00` : "",
  };
}
const refs = (rows: OrderableBooking[]) => rows.map((r) => r.reference_code);

console.log("bookings list order");

// ---- the bands --------------------------------------------------------------

test("statuses land in the right band", () => {
  assert.equal(bandOf("checked_in"), 0, "in the building");
  assert.equal(bandOf("confirmed"), 1, "still to come");
  assert.equal(bandOf("pending_verification"), 1, "still to come, deposit unverified");
  assert.equal(bandOf("checked_out"), 2, "history");
  assert.equal(bandOf("cancelled"), 2, "history");
  assert.equal(bandOf("no_show"), 2, "history");
});

test("an unknown status is treated as live, not buried in history", () => {
  // A status added to the enum later must not silently sort under the
  // cancellations, where nobody would serve it.
  assert.equal(bandOf("some_future_status"), 1);
});

test("in-house first, then arrivals, then history — whatever order they arrive in", () => {
  const sorted = sortForFrontDesk([
    bk("PAST", "checked_out", "2026-08-16T14:00"),
    bk("SOON", "confirmed", "2026-08-18T13:00"),
    bk("HERE", "checked_in", "2026-08-17T14:00"),
    bk("LATER", "confirmed", "2026-09-03T14:00"),
    bk("VOID", "cancelled", "2026-08-14T14:00"),
  ]);
  assert.deepEqual(refs(sorted), ["HERE", "SOON", "LATER", "PAST", "VOID"]);
});

// ---- the bug this replaced --------------------------------------------------

test("a far-future reservation no longer outranks tonight's arrival", () => {
  // `order by period desc` put SEPT on top. It is the whole reason for this.
  const sorted = sortForFrontDesk([
    bk("SEPT", "confirmed", "2026-09-03T14:00"),
    bk("TONIGHT", "confirmed", "2026-08-17T22:00"),
  ]);
  assert.deepEqual(refs(sorted), ["TONIGHT", "SEPT"]);
});

test("in-house guests are top even though they checked in earliest of anyone", () => {
  const sorted = sortForFrontDesk([
    bk("UPCOMING", "confirmed", "2026-08-20T14:00"),
    bk("INHOUSE", "checked_in", "2026-08-15T14:00"),
  ]);
  assert.deepEqual(refs(sorted), ["INHOUSE", "UPCOMING"]);
});

// ---- direction within each band ---------------------------------------------

test("arrivals read forwards — soonest first", () => {
  const sorted = sortForFrontDesk([
    bk("C", "confirmed", "2026-08-22T14:00"),
    bk("A", "confirmed", "2026-08-17T22:00"),
    bk("B", "confirmed", "2026-08-18T13:00"),
  ]);
  assert.deepEqual(refs(sorted), ["A", "B", "C"]);
});

test("history reads backwards — most recent first", () => {
  const sorted = sortForFrontDesk([
    bk("OLD", "checked_out", "2026-08-09T14:00"),
    bk("RECENT", "checked_out", "2026-08-16T14:00"),
    bk("MIDDLE", "cancelled", "2026-08-14T14:00"),
  ]);
  assert.deepEqual(refs(sorted), ["RECENT", "MIDDLE", "OLD"]);
});

test("in-house reads forwards — whoever has been in longest first", () => {
  const sorted = sortForFrontDesk([
    bk("LATE", "checked_in", "2026-08-17T18:30"),
    bk("EARLY", "checked_in", "2026-08-17T14:00"),
  ]);
  assert.deepEqual(refs(sorted), ["EARLY", "LATE"]);
});

// ---- the deliberate edge cases ----------------------------------------------

test("an overdue arrival sorts to the TOP of the upcoming band", () => {
  // Confirmed, arrival already passed, never checked in and never marked
  // no-show. It is the oldest unanswered arrival and it wants a decision, so
  // being first is the point — not an accident of sorting by date.
  const sorted = sortForFrontDesk([
    bk("TOMORROW", "confirmed", "2026-08-18T13:00"),
    bk("OVERDUE", "confirmed", "2026-08-10T13:00"),
    bk("TONIGHT", "confirmed", "2026-08-17T22:00"),
  ]);
  assert.deepEqual(refs(sorted), ["OVERDUE", "TONIGHT", "TOMORROW"]);
});

test("pending verification queues by arrival like anything else, not above it", () => {
  const sorted = sortForFrontDesk([
    bk("PENDING_LATER", "pending_verification", "2026-09-03T14:00"),
    bk("CONFIRMED_SOON", "confirmed", "2026-08-18T13:00"),
  ]);
  assert.deepEqual(refs(sorted), ["CONFIRMED_SOON", "PENDING_LATER"]);
});

test("same arrival: whoever leaves sooner comes first", () => {
  const sorted = sortForFrontDesk([
    bk("LONG", "confirmed", "2026-08-18T14:00", "2026-08-25T12:00"),
    bk("SHORT", "confirmed", "2026-08-18T14:00", "2026-08-19T12:00"),
  ]);
  assert.deepEqual(refs(sorted), ["SHORT", "LONG"]);
});

test("the order is TOTAL — identical windows never reshuffle between reloads", () => {
  const rows = [
    bk("TI-000003", "confirmed", "2026-08-18T14:00", "2026-08-19T12:00"),
    bk("TI-000001", "confirmed", "2026-08-18T14:00", "2026-08-19T12:00"),
    bk("TI-000002", "confirmed", "2026-08-18T14:00", "2026-08-19T12:00"),
  ];
  assert.deepEqual(refs(sortForFrontDesk(rows)), ["TI-000001", "TI-000002", "TI-000003"]);
  // Same rows handed over in another order must come back the same way.
  assert.deepEqual(refs(sortForFrontDesk([...rows].reverse())), [
    "TI-000001",
    "TI-000002",
    "TI-000003",
  ]);
});

test("a row with an unreadable window stays in its band instead of leading it", () => {
  const sorted = sortForFrontDesk([
    bk("BROKEN", "confirmed", ""),
    bk("FINE", "confirmed", "2026-08-18T13:00"),
  ]);
  assert.deepEqual(refs(sorted), ["FINE", "BROKEN"]);
});

test("the input array is not mutated — the calendar shares the same fetch", () => {
  const rows = [
    bk("B", "confirmed", "2026-09-03T14:00"),
    bk("A", "checked_in", "2026-08-17T14:00"),
  ];
  const before = refs(rows);
  sortForFrontDesk(rows);
  assert.deepEqual(refs(rows), before);
});

test("an empty list is an empty list", () => {
  assert.deepEqual(sortForFrontDesk([]), []);
});

if (process.exitCode) console.error(`\n${passed} passed, with failures.`);
else console.log(`\nAll ${passed} tests passed.`);
