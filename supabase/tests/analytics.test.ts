// Pure unit tests for the admin reports maths and the CSV export. Run with:
//   node --experimental-strip-types supabase/tests/analytics.test.ts
// No DB — both modules are pure. Relative imports (no @/ alias).
//
// Every timestamp is built from LOCAL date parts via at(), because the report
// range itself is local ("1 Aug" means midnight in the inn's timezone). Using
// literal UTC strings would make these tests pass or fail depending on the
// machine's timezone.
import assert from "node:assert/strict";
import {
  computeBookingReport,
  computeFinancialReport,
  nightsBetween,
  rangeBounds,
  type ReportBooking,
  type ReportPayment,
} from "../../src/features/reports/analytics.ts";
import { toCsv } from "../../src/features/reports/csv.ts";

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

function at(y: number, m: number, d: number, h = 12, min = 0): string {
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

function booking(over: Partial<ReportBooking> = {}): ReportBooking {
  return {
    id: "b1",
    referenceCode: "TI-000001",
    guestName: "Guest",
    status: "confirmed",
    source: "walk_in",
    roomId: "r1",
    roomLabel: "101",
    roomTypeId: "type-couple",
    roomTypeName: "Couple",
    quotedTotal: 1000,
    guestCount: 2,
    createdAt: at(2026, 8, 5, 10),
    checkIn: at(2026, 8, 5, 14),
    checkOut: at(2026, 8, 6, 12),
    createdBy: "staff-1",
    createdByName: "Dana Desk",
    verifiedBy: null,
    verifiedByName: null,
    verifiedAt: null,
    ...over,
  };
}

function payment(over: Partial<ReportPayment> = {}): ReportPayment {
  return {
    id: "p1",
    bookingId: "b1",
    bookingRef: "TI-000001",
    guestName: "Guest",
    amount: 500,
    method: "cash",
    reference: null,
    createdAt: at(2026, 8, 5, 15),
    recordedBy: "staff-1",
    recordedByName: "Dana Desk",
    ...over,
  };
}

const RANGE = { from: "2026-08-01", to: "2026-08-31" };

console.log("reports analytics");

// ---- range + night maths ----------------------------------------------------

test("a range is inclusive of both endpoints", () => {
  const { days } = rangeBounds("2026-08-01", "2026-08-31");
  assert.equal(days, 31, "August must be 31 days, not 30");
});

test("a single day is one day, not zero", () => {
  const { days } = rangeBounds("2026-08-05", "2026-08-05");
  assert.equal(days, 1);
});

test("an overnight stay is one night, not the two dates it touches", () => {
  const { start, end } = rangeBounds("2026-08-01", "2026-08-31");
  // 5 Aug 14:00 → 6 Aug 12:00 spans two dates but sells one night.
  assert.equal(nightsBetween(at(2026, 8, 5, 14), at(2026, 8, 6, 12), start, end), 1);
});

test("a three-night stay is three nights", () => {
  const { start, end } = rangeBounds("2026-08-01", "2026-08-31");
  assert.equal(nightsBetween(at(2026, 8, 5, 14), at(2026, 8, 8, 12), start, end), 3);
});

test("a block stay inside one day is one room-night", () => {
  const { start, end } = rangeBounds("2026-08-01", "2026-08-31");
  assert.equal(nightsBetween(at(2026, 8, 5, 10), at(2026, 8, 5, 22), start, end), 1);
});

test("a short stay across midnight is still one room-night", () => {
  const { start, end } = rangeBounds("2026-08-01", "2026-08-31");
  assert.equal(nightsBetween(at(2026, 8, 5, 22), at(2026, 8, 6, 4), start, end), 1);
});

test("a stay straddling the range boundary is clipped to the nights inside", () => {
  const { start, end } = rangeBounds("2026-08-01", "2026-08-03");
  // Nights of 31 Jul, 1 Aug and 2 Aug; only the last two are in range.
  assert.equal(nightsBetween(at(2026, 7, 31, 14), at(2026, 8, 3, 12), start, end), 2);
});

test("a stay entirely outside the range contributes nothing", () => {
  const { start, end } = rangeBounds("2026-08-01", "2026-08-31");
  assert.equal(nightsBetween(at(2026, 9, 5, 14), at(2026, 9, 6, 12), start, end), 0);
});

// ---- financial --------------------------------------------------------------

test("only payments received inside the range are collected", () => {
  const r = computeFinancialReport({
    ...RANGE,
    payments: [
      payment({ id: "in", amount: 500, createdAt: at(2026, 8, 5, 15) }),
      payment({ id: "late", amount: 900, createdAt: at(2026, 9, 1, 9) }),
      payment({ id: "early", amount: 700, createdAt: at(2026, 7, 31, 23) }),
    ],
    bookings: [],
    paidByBooking: new Map(),
  });
  assert.equal(r.collected, 500);
  assert.equal(r.paymentCount, 1);
});

test("the last day of the range is included, midnight to midnight", () => {
  const r = computeFinancialReport({
    ...RANGE,
    payments: [payment({ amount: 250, createdAt: at(2026, 8, 31, 23, 30) })],
    bookings: [],
    paidByBooking: new Map(),
  });
  assert.equal(r.collected, 250, "a payment at 23:30 on the final day must count");
});

test("collections group by payment mode and by the staff who received them", () => {
  const r = computeFinancialReport({
    ...RANGE,
    payments: [
      payment({ id: "a", amount: 500, method: "cash", recordedBy: "s1", recordedByName: "Dana" }),
      payment({ id: "b", amount: 300, method: "cash", recordedBy: "s2", recordedByName: "Cleo" }),
      payment({ id: "c", amount: 900, method: "gcash", recordedBy: "s1", recordedByName: "Dana" }),
    ],
    bookings: [],
    paidByBooking: new Map(),
  });

  assert.deepEqual(
    r.byMethod.map((b) => [b.key, b.count, b.amount]),
    [
      ["gcash", 1, 900],
      ["cash", 2, 800],
    ],
    "biggest bucket first"
  );
  const dana = r.byStaff.find((b) => b.key === "s1");
  assert.equal(dana?.amount, 1400);
  assert.equal(dana?.count, 2);
});

test("a payment with no recorder is reported as unattributed, never dropped", () => {
  const r = computeFinancialReport({
    ...RANGE,
    payments: [payment({ amount: 400, recordedBy: null, recordedByName: null })],
    bookings: [],
    paidByBooking: new Map(),
  });
  assert.equal(r.byStaff.length, 1);
  assert.equal(r.byStaff[0].key, "unattributed");
  assert.equal(r.byStaff[0].amount, 400, "its money still shows up somewhere");
  assert.equal(
    r.byStaff.reduce((acc, b) => acc + b.amount, 0),
    r.collected,
    "the staff breakdown must reconcile with the total"
  );
});

test("booked revenue excludes cancelled and no-show bookings", () => {
  const r = computeFinancialReport({
    ...RANGE,
    payments: [],
    bookings: [
      booking({ id: "ok", quotedTotal: 1000, status: "confirmed" }),
      booking({ id: "gone", quotedTotal: 800, status: "cancelled" }),
      booking({ id: "ghost", quotedTotal: 600, status: "no_show" }),
    ],
    paidByBooking: new Map(),
  });
  assert.equal(r.bookedRevenue, 1000);
  assert.equal(r.voidedValue, 1400);
});

test("outstanding is the unpaid balance of active stays, whenever they were booked", () => {
  const r = computeFinancialReport({
    ...RANGE,
    payments: [],
    bookings: [
      // Booked in June — outside the range — but still owes money now.
      booking({ id: "old", quotedTotal: 2000, status: "checked_in", createdAt: at(2026, 6, 1, 9) }),
      booking({ id: "done", quotedTotal: 5000, status: "checked_out" }),
    ],
    paidByBooking: new Map([["old", 1200]]),
  });
  assert.equal(r.outstanding, 800, "2000 quoted − 1200 paid; checked-out stays are settled");
});

test("the daily series has one point per day in the range", () => {
  const r = computeFinancialReport({
    from: "2026-08-01",
    to: "2026-08-07",
    payments: [payment({ amount: 300, createdAt: at(2026, 8, 3, 10) })],
    bookings: [],
    paidByBooking: new Map(),
  });
  assert.equal(r.daily.length, 7);
  assert.equal(r.daily[2].value, 300, "3 Aug is the third point");
  assert.equal(
    r.daily.reduce((acc, d) => acc + d.value, 0),
    r.collected,
    "the day series must reconcile with the total"
  );
});

// ---- bookings ---------------------------------------------------------------

test("bookings taken uses the booking date, occupancy uses the stay dates", () => {
  const r = computeBookingReport({
    ...RANGE,
    roomsTotal: 2,
    bookings: [
      // Booked in July for an August stay: not "taken" in range, but it does
      // occupy a room in range.
      booking({
        id: "early-booking",
        createdAt: at(2026, 7, 20, 9),
        checkIn: at(2026, 8, 10, 14),
        checkOut: at(2026, 8, 11, 12),
      }),
      // Booked in range for a September stay: taken, but occupies nothing yet.
      booking({
        id: "far-stay",
        createdAt: at(2026, 8, 20, 9),
        checkIn: at(2026, 9, 10, 14),
        checkOut: at(2026, 9, 11, 12),
      }),
    ],
  });
  assert.equal(r.totalTaken, 1);
  assert.equal(r.taken[0].id, "far-stay");
  assert.equal(r.roomNights, 1, "only the August stay occupies a room in range");
});

test("cancelled stays occupy nothing", () => {
  const r = computeBookingReport({
    ...RANGE,
    roomsTotal: 1,
    bookings: [booking({ status: "cancelled" })],
  });
  assert.equal(r.roomNights, 0);
  assert.equal(r.occupancyPct, 0);
});

test("occupancy is room-nights sold over rooms times days", () => {
  const r = computeBookingReport({
    from: "2026-08-01",
    to: "2026-08-02",
    roomsTotal: 2,
    bookings: [
      booking({
        id: "s1",
        roomId: "r1",
        checkIn: at(2026, 8, 1, 14),
        checkOut: at(2026, 8, 3, 12),
      }),
    ],
  });
  assert.equal(r.availableRoomNights, 4, "2 rooms × 2 days");
  assert.equal(r.roomNights, 2, "nights of 1 and 2 Aug");
  assert.equal(r.occupancyPct, 50);
});

test("a stay crossing the range edge contributes only its in-range value", () => {
  const r = computeBookingReport({
    from: "2026-08-01",
    to: "2026-08-01",
    roomsTotal: 1,
    bookings: [
      // Two nights (31 Jul and 1 Aug) at 1000 total; only 1 Aug is in range.
      booking({
        quotedTotal: 1000,
        checkIn: at(2026, 7, 31, 14),
        checkOut: at(2026, 8, 2, 12),
      }),
    ],
  });
  assert.equal(r.roomNights, 1);
  assert.equal(r.stayRevenue, 500, "half the stay is in range, so half its value is");
  assert.equal(r.adr, 500);
});

test("average nightly rate reflects nights, not dates touched", () => {
  const r = computeBookingReport({
    ...RANGE,
    roomsTotal: 1,
    bookings: [
      // One night at 1500 — ADR must be 1500, not 750.
      booking({ quotedTotal: 1500, checkIn: at(2026, 8, 5, 14), checkOut: at(2026, 8, 6, 12) }),
    ],
  });
  assert.equal(r.roomNights, 1);
  assert.equal(r.adr, 1500);
});

test("portal bookings are attributed to the channel, not hidden", () => {
  const r = computeBookingReport({
    ...RANGE,
    roomsTotal: 1,
    bookings: [
      booking({ id: "walkin", source: "walk_in", createdBy: "s1", createdByName: "Dana" }),
      booking({ id: "web", source: "portal", createdBy: null, createdByName: null }),
    ],
  });
  const keys = r.byStaff.map((b) => b.key);
  assert.ok(keys.includes("s1"));
  assert.ok(keys.includes("portal"), "a guest-made booking still lands in a bucket");
  assert.equal(
    r.byStaff.reduce((acc, b) => acc + b.count, 0),
    2,
    "the staff breakdown must account for every booking"
  );
});

test("deposit verifications are credited to the verifier, in the range they happened", () => {
  const r = computeBookingReport({
    ...RANGE,
    roomsTotal: 1,
    bookings: [
      booking({
        id: "v1",
        source: "portal",
        createdBy: null,
        createdByName: null,
        verifiedBy: "s2",
        verifiedByName: "Cleo Clerk",
        verifiedAt: at(2026, 8, 6, 9),
      }),
      booking({
        id: "v2",
        source: "portal",
        verifiedBy: "s2",
        verifiedByName: "Cleo Clerk",
        verifiedAt: at(2026, 7, 6, 9),
      }),
    ],
  });
  assert.equal(r.verifiedByStaff.length, 1);
  assert.equal(r.verifiedByStaff[0].key, "s2");
  assert.equal(r.verifiedByStaff[0].count, 1, "only the August verification counts");
});

// ---- filters ----------------------------------------------------------------

test("the room type filter narrows bookings, room-nights and the payments with them", () => {
  const bookings = [
    booking({ id: "couple", roomTypeId: "t-couple", quotedTotal: 1000 }),
    booking({ id: "family", roomTypeId: "t-family", quotedTotal: 4000 }),
  ];
  const filters = { roomTypeId: "t-couple", staffId: null };

  const fin = computeFinancialReport({
    ...RANGE,
    bookings,
    paidByBooking: new Map(),
    filters,
    payments: [
      payment({ id: "p-couple", bookingId: "couple", amount: 500 }),
      payment({ id: "p-family", bookingId: "family", amount: 4000 }),
    ],
  });
  assert.equal(fin.collected, 500, "only the couple room's payment is collected");
  assert.equal(fin.bookedRevenue, 1000);

  // roomsTotal is the count of rooms OF THAT TYPE — the repository narrows the
  // denominator, or the filtered numerator would read as an occupancy crash.
  const bk = computeBookingReport({ ...RANGE, bookings, roomsTotal: 1, filters });
  assert.equal(bk.totalTaken, 1);
  assert.equal(bk.roomNights, 1, "only the couple room's night is sold");
  assert.deepEqual(
    bk.byRoomType.map((x) => x.label),
    ["Couple"]
  );
});

test("the staff filter follows each attribution to its own column", () => {
  const bookings = [
    // Dana took this one at the desk.
    booking({ id: "dana", createdBy: "dana", createdByName: "Dana Desk" }),
    // Cleo took this one.
    booking({ id: "cleo", createdBy: "cleo", createdByName: "Cleo Clerk" }),
    // Nobody "took" a portal booking — but Dana verified its deposit. This is
    // the case that breaks if verifications are scoped by created_by.
    booking({
      id: "portal",
      source: "portal",
      createdBy: null,
      createdByName: null,
      verifiedBy: "dana",
      verifiedByName: "Dana Desk",
      verifiedAt: at(2026, 8, 6, 9),
    }),
  ];
  const filters = { roomTypeId: null, staffId: "dana" };

  const bk = computeBookingReport({ ...RANGE, bookings, roomsTotal: 3, filters });
  assert.equal(bk.totalTaken, 1, "bookings taken follows created_by");
  assert.equal(bk.taken[0].id, "dana");
  assert.equal(bk.verifiedByStaff.length, 1, "verifications follow verified_by");
  assert.equal(bk.verifiedByStaff[0].count, 1);

  const fin = computeFinancialReport({
    ...RANGE,
    bookings,
    paidByBooking: new Map(),
    filters,
    payments: [
      payment({ id: "p1", bookingId: "cleo", amount: 900, recordedBy: "dana" }),
      payment({ id: "p2", bookingId: "dana", amount: 700, recordedBy: "cleo" }),
    ],
  });
  assert.equal(
    fin.collected,
    900,
    "money follows recorded_by — Dana receiving cash on Cleo's booking is Dana's collection"
  );
});

test("the two filters compose", () => {
  const bookings = [
    booking({ id: "a", roomTypeId: "t-couple", createdBy: "dana", quotedTotal: 1000 }),
    booking({ id: "b", roomTypeId: "t-couple", createdBy: "cleo", quotedTotal: 1000 }),
    booking({ id: "c", roomTypeId: "t-family", createdBy: "dana", quotedTotal: 4000 }),
  ];
  const r = computeBookingReport({
    ...RANGE,
    bookings,
    roomsTotal: 1,
    filters: { roomTypeId: "t-couple", staffId: "dana" },
  });
  assert.equal(r.totalTaken, 1);
  assert.equal(r.taken[0].id, "a");
});

test("no filters leaves every figure exactly as it was", () => {
  const bookings = [
    booking({ id: "a", roomTypeId: "t-couple", createdBy: "dana" }),
    booking({ id: "b", roomTypeId: "t-family", createdBy: "cleo" }),
  ];
  const plain = computeBookingReport({ ...RANGE, bookings, roomsTotal: 2 });
  const explicit = computeBookingReport({
    ...RANGE,
    bookings,
    roomsTotal: 2,
    filters: { roomTypeId: null, staffId: null },
  });
  assert.equal(plain.totalTaken, 2);
  assert.deepEqual(explicit, plain, "an empty filter must be a no-op, not a subtly different path");
});

// ---- CSV --------------------------------------------------------------------

console.log("csv export");

test("commas, quotes and newlines survive a round trip through quoting", () => {
  const csv = toCsv(["Guest", "Note"], [["Smith, John", 'He said "hi"\nthen left']]);
  assert.equal(csv, 'Guest,Note\r\n"Smith, John","He said ""hi""\nthen left"');
});

test("a leading = is neutralised so spreadsheets do not execute it", () => {
  const csv = toCsv(["Name"], [["=1+1"]]);
  assert.equal(csv, "Name\r\n'=1+1", "the value stays readable but inert");
});

test("null and undefined become empty cells, and numbers stay unquoted", () => {
  const csv = toCsv(["A", "B", "C"], [[null, undefined, 1250.5]]);
  assert.equal(csv, "A,B,C\r\n,,1250.5");
});

if (process.exitCode) {
  console.error(`\n${passed} passed, with failures.`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
